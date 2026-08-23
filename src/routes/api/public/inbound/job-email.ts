import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { z } from "zod";
import { WebhookError, verifyWebhookRequest } from "@lovable.dev/webhooks-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseEmail, type EmailInput } from "@/lib/job-leads/parse";
import { ingestParsedEmail } from "@/lib/job-leads/ingest";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
  "Access-Control-Max-Age": "86400",
};

const RATE_LIMIT_ALIAS_PER_HOUR = 60;
const RATE_LIMIT_IP_PER_DAY = 100;

const lovableEmailPayloadSchema = z.object({
  version: z.string().optional(),
  type: z.string().optional(),
  data: z.object({
    from: z.string().email().optional(),
    to: z.string().email().optional(),
    subject: z.string().default(""),
    "body-plain": z.string().default(""),
    "body-html": z.string().nullable().default(null),
    "recipient": z.string().email().optional(),
    "sender": z.string().email().optional(),
    "stripped-text": z.string().default(""),
    "stripped-html": z.string().nullable().default(null),
  }),
});

const mailgunFormSchema = z.object({
  timestamp: z.string(),
  token: z.string(),
  signature: z.string(),
  recipient: z.string().email(),
  sender: z.string().email().optional(),
  from: z.string().email().optional(),
  subject: z.string().default(""),
  "body-plain": z.string().default(""),
  "body-html": z.string().nullable().default(null),
  "stripped-text": z.string().default(""),
  "stripped-html": z.string().nullable().default(null),
});

function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function ipHash(ip: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${ip}|${today}`).digest("hex");
}

function extractAliasToken(email: string): string | null {
  const local = email.split("@")[0];
  if (!local) return null;
  return local.trim().toLowerCase();
}

async function verifyMailgunSignature(
  timestamp: string,
  token: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = encoder.encode(timestamp + token);
  const mac = await crypto.subtle.sign("HMAC", key, data);
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function nowHour(): Date {
  const d = new Date();
  d.setUTCMinutes(0, 0, 0);
  return d;
}

export const Route = createFileRoute("/api/public/inbound/job-email")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),

      POST: async ({ request }) => {
        const ip = getClientIp(request);
        const ipH = ipHash(ip);
        const eventHour = nowHour().toISOString();
        let aliasToken: string | null = null;

        // 1. Record a pending rate event before any work, so even unknown aliases are counted.
        const { data: pendingEvent, error: pendingError } = await supabaseAdmin
          .from("inbound_email_rate_events")
          .insert({ ip_hash: ipH, alias_token: null, outcome: "pending", event_hour: eventHour })
          .select("id")
          .single();

        if (pendingError || !pendingEvent) {
          console.error("[inbound/job-email] failed to create pending rate event", pendingError);
          return Response.json({ error: "internal_error" }, { status: 500, headers: CORS_HEADERS });
        }

        const rateEventId = pendingEvent.id;

        async function finalize(outcome: string, status: number, body: Record<string, unknown>) {
          await supabaseAdmin
            .from("inbound_email_rate_events")
            .update({ outcome, alias_token: aliasToken })
            .eq("id", rateEventId);
          return Response.json(body, { status, headers: CORS_HEADERS });
        }

        // 2. Parse the incoming body and verify its signature.
        let emailInput: EmailInput;
        let rawText: string;
        let rawHtml: string | null;

        const isLovableWebhook =
          request.headers.get("x-lovable-signature") || request.headers.get("x-lovable-timestamp");

        if (isLovableWebhook) {
          const apiKey = process.env["LOVABLE_API_KEY"];
          if (!apiKey) {
            return finalize("rejected", 500, { error: "missing_webhook_secret" });
          }
          let payload: z.infer<typeof lovableEmailPayloadSchema>;
          try {
            const verified = await verifyWebhookRequest({
              req: request,
              secret: apiKey,
              parser: (body) => {
                const parsed = JSON.parse(body);
                return lovableEmailPayloadSchema.parse(parsed);
              },
            });
            payload = verified.payload;
          } catch (error) {
            if (error instanceof WebhookError) {
              return finalize("rejected", 401, { error: "invalid_signature" });
            }
            return finalize("rejected", 400, { error: "invalid_payload" });
          }
          const data = payload.data;
          const to = data.to || data.recipient;
          const from = data.from || data.sender || data.sender || "unknown@unknown";
          if (!to) {
            return finalize("rejected", 400, { error: "missing_recipient" });
          }
          rawText = data["stripped-text"] || data["body-plain"] || "";
          rawHtml = data["stripped-html"] || data["body-html"] || null;
          emailInput = {
            from,
            to,
            subject: data.subject,
            text: rawText,
            html: rawHtml,
            receivedAt: new Date().toISOString(),
          };
        } else {
          // Direct Mailgun webhook path
          const mailgunSecret = process.env["MAILGUN_WEBHOOK_SIGNING_KEY"];
          if (!mailgunSecret) {
            return finalize("rejected", 500, { error: "missing_webhook_secret" });
          }
          let form: FormData;
          try {
            form = await request.formData();
          } catch {
            return finalize("rejected", 400, { error: "invalid_form_data" });
          }
          const fields = Object.fromEntries(form.entries());
          const parsed = mailgunFormSchema.safeParse(fields);
          if (!parsed.success) {
            return finalize("rejected", 400, { error: "validation_failed", details: parsed.error.flatten() });
          }
          const p = parsed.data;
          const valid = await verifyMailgunSignature(p.timestamp, p.token, p.signature, mailgunSecret);
          if (!valid) {
            return finalize("rejected", 401, { error: "invalid_signature" });
          }
          aliasToken = extractAliasToken(p.recipient);
          rawText = p["stripped-text"] || p["body-plain"] || "";
          rawHtml = p["stripped-html"] || p["body-html"] || null;
          emailInput = {
            from: p.from || p.sender || "unknown@unknown",
            to: p.recipient,
            subject: p.subject,
            text: rawText,
            html: rawHtml,
            receivedAt: new Date().toISOString(),
          };
        }

        // 3. Resolve the alias token (if not already known from Mailgun form data).
        if (!aliasToken) {
          aliasToken = extractAliasToken(emailInput.to);
        }

        // 4. Rate-limit checks.
        if (aliasToken) {
          const { count: aliasCount } = await supabaseAdmin
            .from("inbound_email_rate_events")
            .select("id", { count: "exact", head: true })
            .eq("alias_token", aliasToken)
            .eq("event_hour", eventHour)
            .not("outcome", "in", "(unknown_alias,rejected)");
          if ((aliasCount ?? 0) >= RATE_LIMIT_ALIAS_PER_HOUR) {
            return finalize("rate_limited", 429, { error: "rate_limited_alias" });
          }
        }

        const sinceMidnight = new Date();
        sinceMidnight.setUTCHours(0, 0, 0, 0);
        const { count: ipCount } = await supabaseAdmin
          .from("inbound_email_rate_events")
          .select("id", { count: "exact", head: true })
          .eq("ip_hash", ipH)
          .gte("event_hour", sinceMidnight.toISOString());
        if ((ipCount ?? 0) >= RATE_LIMIT_IP_PER_DAY) {
          return finalize("rate_limited", 429, { error: "rate_limited_ip" });
        }

        // 5. Look up email_job_sources by alias token.
        const { data: source } = await supabaseAdmin
          .from("email_job_sources")
          .select("id, user_id, source_system, intake_mode, email_connection_id, is_active")
          .eq("inbound_alias_token", aliasToken)
          .maybeSingle();

        if (!source) {
          return finalize("unknown_alias", 404, { error: "unknown_alias" });
        }

        if (!source.is_active) {
          return finalize("rejected", 403, { error: "inactive_source" });
        }

        // 6. Parse the email into a lead.
        const parseResult = parseEmail(emailInput);
        if (!parseResult.ok) {
          return finalize("rejected", 422, { error: parseResult.rejectReason });
        }

        const providerMessageId = createHash("sha256")
          .update(`${emailInput.from}|${emailInput.to}|${emailInput.subject}|${emailInput.receivedAt}`)
          .digest("hex");

        // 7. Persist parsed lead and create job_lead row.
        try {
          await ingestParsedEmail({
            userId: source.user_id,
            emailJobSourceId: source.id,
            sourceSystem: source.source_system,
            intakeMode: source.intake_mode as "mailbox" | "forwarding",
            emailConnectionId: source.email_connection_id,
            providerMessageId,
            fromAddress: emailInput.from,
            toAddress: emailInput.to,
            subject: emailInput.subject,
            receivedAt: emailInput.receivedAt,
            rawText,
            rawHtml,
            sizeBytes: rawText.length + (rawHtml?.length ?? 0),
            parsed: parseResult.lead,
            parseConfidence: parseResult.lead.confidence,
          });
        } catch (err) {
          console.error("[inbound/job-email] ingest failed", err);
          return finalize("rejected", 500, { error: "ingest_failed" });
        }

        return finalize("accepted", 200, { ok: true });
      },
    },
  },
});
