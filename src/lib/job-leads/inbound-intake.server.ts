// ============================================================
// Serverside for innkommende e-post: konfigurasjonsport og revisjonsspor.
//
// Mottak er slått AV til både domenet og en leverandørhemmelighet er
// konfigurert. Ingen hemmelighet leses eller returneres — vi sjekker
// kun tilstedeværelse.
// ============================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type InboundProvider = "lovable" | "mailgun";

export type InboundIntakeConfig = {
  domain: string | null;
  providers: InboundProvider[];
  ready: boolean;
};

export function inboundIntakeConfig(): InboundIntakeConfig {
  const domain = (process.env["INBOUND_EMAIL_DOMAIN"] ?? "").trim().toLowerCase() || null;
  const providers: InboundProvider[] = [];
  if (process.env["LOVABLE_API_KEY"]) providers.push("lovable");
  if (process.env["MAILGUN_WEBHOOK_SIGNING_KEY"]) providers.push("mailgun");
  return { domain, providers, ready: Boolean(domain) && providers.length > 0 };
}

export type DeliveryOutcome = "accepted" | "duplicate" | "parse_failed" | "ingest_failed";

/**
 * Skriver én revisjonsrad per mottatt melding. Unik indeks på
 * (kilde, leverandør, meldings-id) gjør registreringen idempotent:
 * andre gang samme melding kommer inn, returneres duplicate=true.
 * Raden inneholder aldri e-postinnhold.
 */
export async function recordInboundDelivery(params: {
  userId: string;
  emailJobSourceId: string;
  provider: InboundProvider;
  providerMessageId: string;
  aliasToken: string;
  fromDomain: string | null;
  sizeBytes: number;
  outcome: DeliveryOutcome;
  rejectReason?: string | null;
  importedJobEmailId?: string | null;
  receivedAt: string;
}): Promise<{ duplicate: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("inbound_email_deliveries")
    .upsert(
      {
        user_id: params.userId,
        email_job_source_id: params.emailJobSourceId,
        provider: params.provider,
        provider_message_id: params.providerMessageId,
        alias_token: params.aliasToken,
        from_domain: params.fromDomain,
        size_bytes: params.sizeBytes,
        outcome: params.outcome,
        reject_reason: params.rejectReason ?? null,
        imported_job_email_id: params.importedJobEmailId ?? null,
        received_at: params.receivedAt,
      },
      { onConflict: "email_job_source_id,provider,provider_message_id", ignoreDuplicates: true },
    )
    .select("id");

  if (error) {
    console.error("[inbound-intake] failed to record delivery", {
      code: error.code,
      message: error.message,
    });
    return { duplicate: false };
  }
  return { duplicate: (data?.length ?? 0) === 0 };
}

export function senderDomain(from: string): string | null {
  const at = from.lastIndexOf("@");
  if (at < 0) return null;
  const d = from
    .slice(at + 1)
    .replace(/[>\s]/g, "")
    .toLowerCase();
  return d || null;
}
