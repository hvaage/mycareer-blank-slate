/**
 * Server-only helpers for the inbound job-email webhook.
 *
 * Invariants:
 *  1. Inbound receiving stays OFF unless BOTH the inbound domain and the
 *     Mailgun webhook signing key are configured. Mailgun is the only
 *     documented, cryptographically verified inbound provider.
 *  2. A delivery is claimed atomically through `inbound_email_claim_delivery`
 *     BEFORE any ingestion. `processing` is the only active lease state, so
 *     replays and concurrent deliveries can never produce two imports.
 *  3. A failed attempt (`parse_failed`, `ingest_failed`) or a crashed attempt
 *     (expired lease) can be claimed again later. Only a terminal `accepted`
 *     blocks further processing permanently.
 *  4. Finalization requires the claim token of the current lease, so a worker
 *     whose lease was taken over can never overwrite the new attempt.
 */

import { createHash } from "crypto";

export const INBOUND_PROVIDER = "mailgun" as const;

export type InboundConfig = {
  domain: string;
  mailgunSigningKey: string;
};

export type InboundConfigResult =
  | { ok: true; config: InboundConfig }
  | { ok: false; reason: "missing_inbound_domain" | "missing_webhook_secret" };

export function readInboundConfig(
  env: Record<string, string | undefined> = process.env,
): InboundConfigResult {
  const domain = (env["INBOUND_EMAIL_DOMAIN"] ?? "").trim().toLowerCase();
  if (!domain) return { ok: false, reason: "missing_inbound_domain" };
  const mailgunSigningKey = (env["MAILGUN_WEBHOOK_SIGNING_KEY"] ?? "").trim();
  if (!mailgunSigningKey) return { ok: false, reason: "missing_webhook_secret" };
  return { ok: true, config: { domain, mailgunSigningKey } };
}

const ALIAS_TOKEN_RE = /^[a-z2-7]{26,64}$/;

/**
 * Extracts the alias token from a recipient address, but ONLY when the
 * address belongs to the configured inbound domain. Any other host — including
 * subdomains and superdomains of it — is rejected.
 */
export function aliasTokenForRecipient(recipient: string, configuredDomain: string): string | null {
  const raw = recipient.trim().toLowerCase();
  const at = raw.lastIndexOf("@");
  if (at <= 0 || at === raw.length - 1) return null;
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  if (domain !== configuredDomain.trim().toLowerCase()) return null;
  // No plus-addressing or dots: the alias token is the whole local part.
  if (!ALIAS_TOKEN_RE.test(local)) return null;
  return local;
}

export function fromDomain(address: string): string | null {
  const at = address.lastIndexOf("@");
  if (at < 0) return null;
  const d = address
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return d || null;
}

/**
 * Stable identity of a provider message.
 *
 * Mailgun's `Message-Id` header is used whenever present. Without it, the
 * fallback hashes ONLY immutable message content — sender, recipient, subject
 * and body. Receive time, webhook timestamp, tokens and signatures are never
 * part of the identity, because a redelivery of the same email must produce
 * the same value.
 */
export function stableProviderMessageId(input: {
  messageIdHeader?: string | null;
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
}): string {
  const header = (input.messageIdHeader ?? "").trim();
  const basis = header
    ? `mid:${header}`
    : [
        "content",
        input.from.trim().toLowerCase(),
        input.to.trim().toLowerCase(),
        input.subject,
        input.bodyText,
        input.bodyHtml ?? "",
      ].join("\u0000");
  return createHash("sha256").update(basis).digest("hex");
}

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

export type ClaimResult =
  | { status: "claimed"; deliveryId: string; claimToken: string; attemptNumber: number }
  | { status: "duplicate"; deliveryId: string }
  | { status: "in_progress"; deliveryId: string }
  | { status: "error"; message: string };

export type ClaimInput = {
  user_id: string;
  email_job_source_id: string;
  alias_token: string;
  provider_message_id: string;
  from_domain: string | null;
  size_bytes: number | null;
  lease_seconds?: number;
};

function firstRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return (data[0] as Record<string, unknown>) ?? null;
  if (data && typeof data === "object") return data as Record<string, unknown>;
  return null;
}

/**
 * Atomically claims a delivery. The database serializes the decision, so
 * exactly one concurrent caller gets `claimed`; the others get `duplicate`
 * (already accepted) or `in_progress` (another live lease).
 */
export async function claimInboundDelivery(
  admin: RpcClient,
  values: ClaimInput,
): Promise<ClaimResult> {
  const { data, error } = await admin.rpc("inbound_email_claim_delivery", {
    p_user_id: values.user_id,
    p_email_job_source_id: values.email_job_source_id,
    p_alias_token: values.alias_token,
    p_provider: INBOUND_PROVIDER,
    p_provider_message_id: values.provider_message_id,
    p_from_domain: values.from_domain,
    p_size_bytes: values.size_bytes,
    p_lease_seconds: values.lease_seconds ?? 300,
  });

  if (error) return { status: "error", message: error.message ?? "claim_failed" };

  const row = firstRow(data);
  if (!row) return { status: "error", message: "claim_returned_no_row" };

  const status = String(row["status"] ?? "");
  const deliveryId = String(row["delivery_id"] ?? "");

  if (status === "claimed") {
    const claimToken = row["claim_token"];
    if (typeof claimToken !== "string" || !claimToken) {
      return { status: "error", message: "claim_returned_no_token" };
    }
    return {
      status: "claimed",
      deliveryId,
      claimToken,
      attemptNumber: Number(row["attempt_number"] ?? 1),
    };
  }
  if (status === "duplicate") return { status: "duplicate", deliveryId };
  if (status === "in_progress") return { status: "in_progress", deliveryId };
  return { status: "error", message: `unexpected_claim_status:${status}` };
}

export type FinalizeOutcome = "accepted" | "parse_failed" | "ingest_failed";

export type FinalizeResult =
  | { status: "finalized"; outcome: FinalizeOutcome }
  | { status: "lease_lost" }
  | { status: "not_found" }
  | { status: "error"; message: string };

/**
 * Writes the terminal outcome for the attempt this worker owns. `accepted` is
 * only ever written after the import and job lead are fully persisted.
 */
export async function finalizeInboundDelivery(
  admin: RpcClient,
  values: {
    deliveryId: string;
    claimToken: string;
    outcome: FinalizeOutcome;
    rejectReason?: string | null;
    importedJobEmailId?: string | null;
  },
): Promise<FinalizeResult> {
  const { data, error } = await admin.rpc("inbound_email_finalize_delivery", {
    p_delivery_id: values.deliveryId,
    p_claim_token: values.claimToken,
    p_outcome: values.outcome,
    p_reject_reason: values.rejectReason ?? null,
    p_imported_job_email_id: values.importedJobEmailId ?? null,
  });

  if (error) return { status: "error", message: error.message ?? "finalize_failed" };

  const row = firstRow(data);
  const status = String(row?.["status"] ?? "");
  if (status === "finalized") return { status: "finalized", outcome: values.outcome };
  if (status === "lease_lost") return { status: "lease_lost" };
  if (status === "not_found") return { status: "not_found" };
  return { status: "error", message: `unexpected_finalize_status:${status}` };
}
