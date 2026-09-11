import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseEmail, type EmailInput } from "@/lib/job-leads/parse";
import { ingestParsedEmail } from "@/lib/job-leads/ingest";
import {
  INBOUND_PROVIDER,
  aliasTokenForRecipient,
  claimInboundDelivery,
  finalizeInboundDelivery,
  fromDomain,
  readInboundConfig,
  stableProviderMessageId,
} from "@/lib/job-leads/inbound-email.server";
import {
  parseResendInboundEvent,
  readSvixHeaders,
  verifyResendWebhook,
} from "@/lib/job-leads/resend-webhook.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-client-info, svix-id, svix-timestamp, svix-signature, webhook-id, webhook-timestamp, webhook-signature",
  "Access-Control-Max-Age": "86400",
};

const RATE_LIMIT_ALIAS_PER_HOUR = 60;
const RATE_LIMIT_IP_PER_DAY = 100;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB

function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "unknown";
}

function ipHash(ip: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${ip}|${today}`).digest("hex");
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
        // and the Resend webhook secret are both configured.
        const configResult = readInboundConfig();
        if (!configResult.ok) {
          return Response.json(
            { error: "inbound_not_configured", reason: configResult.reason },
            { status: 503, headers: CORS_HEADERS },
          );
        }
        const { domain: inboundDomain, resendWebhookSecret } = configResult.config;

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

        // 3. Resend is the only supported inbound provider. Verify the Svix
        // signature over the RAW body before trusting any field.
        let rawBody: string;
        try {
          rawBody = await request.text();
        } catch {
          return finalize("rejected", 400, { error: "invalid_body" });
        }
        if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
          return finalize("rejected", 413, { error: "payload_too_large" });
        }

        const verification = await verifyResendWebhook({
          headers: readSvixHeaders(request.headers),
          rawBody,
          secret: resendWebhookSecret,
        });
        if (!verification.ok) {
          return finalize("rejected", 401, {
            error: "invalid_signature",
            reason: verification.reason,
          });
        }

        const event = parseResendInboundEvent(rawBody);
        if (!event.ok) {
          const status = event.reason === "unsupported_event_type" ? 202 : 400;
          return finalize("rejected", status, { error: event.reason });
        }
        const p = event.email;

        const rawText = p.text;
        const rawHtml = p.html;
        const emailInput: EmailInput = {
          from: p.from,
          to: p.to,
          subject: p.subject,
          text: rawText,
          html: rawHtml,
          receivedAt: new Date().toISOString(),
        };

        // 4. Alias is only accepted on the exact configured inbound domain.
        aliasToken = aliasTokenForRecipient(p.to, inboundDomain);
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

        // Stable message identity: the original Message-ID header, else the
        // Svix event id (stable across retries), else a hash over immutable
        // message content. The receive time is never part of the identity.
        const providerMessageId = stableProviderMessageId({
          messageIdHeader: p.messageIdHeader,
          eventId: verification.eventId,
          from: emailInput.from,
          to: p.to,
          subject: p.subject,
          bodyText: rawText,
          bodyHtml: rawHtml,
        });

        // 7. Atomic lease claim BEFORE ingestion. `processing` is the only
        // active lease state, so only one concurrent delivery of the same
        // message proceeds; failed or crashed attempts can be retried later.
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
        if (claim.status === "in_progress") {
          return finalize("accepted", 200, { ok: true, duplicate: true, in_progress: true });
        }
        if (claim.status === "error") {
          console.error("[inbound/job-email] delivery claim failed", claim.message);
          return finalize("rejected", 500, { error: "internal_error" });
        }

        const { deliveryId, claimToken } = claim;

        // 8. Parse the email into a lead.
        const parseResult = parseEmail(emailInput);
        if (!parseResult.ok) {
          await finalizeInboundDelivery(supabaseAdmin as never, {
            deliveryId,
            claimToken,
            outcome: "parse_failed",
            rejectReason: parseResult.rejectReason,
          });
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
          // Terminal `accepted` only after import AND job lead are persisted.
          await finalizeInboundDelivery(supabaseAdmin as never, {
            deliveryId,
            claimToken,
            outcome: "accepted",
            importedJobEmailId: result.importedJobEmailId,
          });
        } catch (err) {
          console.error("[inbound/job-email] ingest failed", err);
          await finalizeInboundDelivery(supabaseAdmin as never, {
            deliveryId,
            claimToken,
            outcome: "ingest_failed",
            rejectReason: "ingest_failed",
          });
          return finalize("rejected", 500, { error: "ingest_failed" });
        }

        return finalize("accepted", 200, { ok: true, provider: INBOUND_PROVIDER });
      },
    },
  },
});
