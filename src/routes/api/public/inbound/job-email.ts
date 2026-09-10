import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseEmail, type EmailInput } from "@/lib/job-leads/parse";
import { ingestParsedEmail } from "@/lib/job-leads/ingest";
import {
  INBOUND_PROVIDER,
  aliasTokenForRecipient,
  claimInboundDelivery,
  fromDomain,
  readInboundConfig,
} from "@/lib/job-leads/inbound-email.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
  "Access-Control-Max-Age": "86400",
};

const RATE_LIMIT_ALIAS_PER_HOUR = 60;
const RATE_LIMIT_IP_PER_DAY = 100;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB

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
  "Message-Id": z.string().optional(),
  "message-id": z.string().optional(),
});

function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "unknown";
}

function ipHash(ip: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${ip}|${today}`).digest("hex");
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
  const expectedBuf = Buffer.from(expected);
  const givenBuf = Buffer.from(signature);
  if (expectedBuf.length !== givenBuf.length) return false;
  return timingSafeEqual(expectedBuf, givenBuf);
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
        // 0. Configuration gate — receiving stays off until the inbound domain
        // and the Mailgun signing key are both configured.
        const configResult = readInboundConfig();
        if (!configResult.ok) {
          return Response.json(
            { error: "inbound_not_configured", reason: configResult.reason },
            { status: 503, headers: CORS_HEADERS },
          );
        }
        const { domain: inboundDomain, mailgunSigningKey } = configResult.config;

        // 1. Size guard — before any parsing or DB work.
        const contentLength = Number(request.headers.get("content-length") ?? "0");
        if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
          return Response.json(
            { error: "payload_too_large" },
            { status: 413, headers: CORS_HEADERS },
          );
        }

        const ip = getClientIp(request);
        const ipH = ipHash(ip);
        const eventHour = nowHour().toISOString();
        let aliasToken: string | null = null;

        // 2. Record a pending rate event before any work, so even unknown
        // aliases are counted.
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

        // 3. Mailgun is the only supported inbound provider. Parse the form
        // body and verify the HMAC signature before trusting any field.
        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return finalize("rejected", 400, { error: "invalid_form_data" });
        }
        const fields = Object.fromEntries(form.entries());
        const parsed = mailgunFormSchema.safeParse(fields);
        if (!parsed.success) {
          return finalize("rejected", 400, {
            error: "validation_failed",
            details: parsed.error.flatten(),
          });
        }
        const p = parsed.data;
        const valid = await verifyMailgunSignature(
          p.timestamp,
          p.token,
          p.signature,
          mailgunSigningKey,
        );
        if (!valid) {
          return finalize("rejected", 401, { error: "invalid_signature" });
        }

        const rawText = p["stripped-text"] || p["body-plain"] || "";
        const rawHtml = p["stripped-html"] || p["body-html"] || null;
        const emailInput: EmailInput = {
          from: p.from || p.sender || "unknown@unknown",
          to: p.recipient,
          subject: p.subject,
          text: rawText,
          html: rawHtml,
          receivedAt: new Date().toISOString(),
        };

        // 4. Alias is only accepted on the configured inbound domain.
        aliasToken = aliasTokenForRecipient(p.recipient, inboundDomain);
        if (!aliasToken) {
          return finalize("unknown_alias", 404, { error: "unknown_alias" });
        }

        // 5. Rate-limit checks.
        const { count: aliasCount } = await supabaseAdmin
          .from("inbound_email_rate_events")
          .select("id", { count: "exact", head: true })
          .eq("alias_token", aliasToken)
          .eq("event_hour", eventHour)
          .not("outcome", "in", "(unknown_alias,rejected)");
        if ((aliasCount ?? 0) >= RATE_LIMIT_ALIAS_PER_HOUR) {
          return finalize("rate_limited", 429, { error: "rate_limited_alias" });
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

        // 6. Look up email_job_sources by alias token.
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

        const messageId =
          p["Message-Id"] ||
          p["message-id"] ||
          `${emailInput.from}|${p.recipient}|${p.subject}|${p.timestamp}`;
        const providerMessageId = createHash("sha256").update(messageId).digest("hex");

        // 7. Atomic idempotency claim BEFORE ingestion. The unique index on
        // (email_job_source_id, provider, provider_message_id) means only one
        // concurrent delivery of the same message proceeds to ingest.
        const claim = await claimInboundDelivery(supabaseAdmin as never, {
          user_id: source.user_id,
          email_job_source_id: source.id,
          alias_token: aliasToken,
          provider_message_id: providerMessageId,
          from_domain: fromDomain(emailInput.from),
          size_bytes: rawText.length + (rawHtml?.length ?? 0),
        });

        if (claim.status === "duplicate") {
          return finalize("accepted", 200, { ok: true, duplicate: true });
        }
        if (claim.status === "error") {
          console.error("[inbound/job-email] delivery claim failed", claim.message);
          return finalize("rejected", 500, { error: "internal_error" });
        }

        // 8. Parse the email into a lead.
        const parseResult = parseEmail(emailInput);
        if (!parseResult.ok) {
          await supabaseAdmin
            .from("inbound_email_deliveries")
            .update({ outcome: "parse_failed", reject_reason: parseResult.rejectReason })
            .eq("id", claim.deliveryId);
          return finalize("rejected", 422, { error: parseResult.rejectReason });
        }

        // 9. Persist parsed lead and create job_lead row.
        try {
          const result = await ingestParsedEmail({
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
          await supabaseAdmin
            .from("inbound_email_deliveries")
            .update({
              outcome: "accepted",
              imported_job_email_id: result.importedJobEmailId,
            })
            .eq("id", claim.deliveryId);
        } catch (err) {
          console.error("[inbound/job-email] ingest failed", err);
          await supabaseAdmin
            .from("inbound_email_deliveries")
            .update({ outcome: "ingest_failed", reject_reason: "ingest_failed" })
            .eq("id", claim.deliveryId);
          return finalize("rejected", 500, { error: "ingest_failed" });
        }

        return finalize("accepted", 200, { ok: true, provider: INBOUND_PROVIDER });
      },
    },
  },
});
