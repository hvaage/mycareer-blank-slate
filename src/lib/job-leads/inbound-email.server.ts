/**
 * Server-only helpers for the inbound job-email webhook.
 *
 * Two invariants live here:
 *  1. Inbound receiving stays OFF unless BOTH the inbound domain and the
 *     Mailgun webhook signing key are configured. Mailgun is the only
 *     documented, cryptographically verified inbound provider.
 *  2. A delivery is claimed atomically in `inbound_email_deliveries` BEFORE
 *     any ingestion, so replays and concurrent webhook deliveries can never
 *     produce more than one imported email or job lead.
 */

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

type DeliveryInsert = {
  user_id: string;
  email_job_source_id: string;
  alias_token: string;
  provider: string;
  provider_message_id: string;
  outcome: string;
  from_domain: string | null;
  size_bytes: number | null;
};

type MinimalAdmin = {
  from: (table: string) => {
    insert: (values: DeliveryInsert) => {
      select: (cols: string) => {
        maybeSingle: () => Promise<{
          data: { id: string } | null;
          error: { code?: string; message?: string } | null;
        }>;
      };
    };
  };
};

export type ClaimResult =
  | { status: "claimed"; deliveryId: string }
  | { status: "duplicate" }
  | { status: "error"; message: string };

const UNIQUE_VIOLATION = "23505";

/**
 * The outcome value used for the reservation row. The database CHECK on
 * `inbound_email_deliveries.outcome` only allows
 * accepted | duplicate | parse_failed | ingest_failed, so the claim is
 * inserted as `accepted` and downgraded to `parse_failed`/`ingest_failed`
 * if later stages fail.
 */
export const CLAIM_OUTCOME = "accepted" as const;

/**
 * Atomically claims a delivery row. The unique index on
 * (email_job_source_id, provider, provider_message_id) makes this the single
 * serialization point: exactly one concurrent caller gets `claimed`.
 */
export async function claimInboundDelivery(
  admin: MinimalAdmin,
  values: Omit<DeliveryInsert, "provider" | "outcome"> & { outcome?: string },
): Promise<ClaimResult> {
  const { data, error } = await admin
    .from("inbound_email_deliveries")
    .insert({
      ...values,
      provider: INBOUND_PROVIDER,
      outcome: values.outcome ?? CLAIM_OUTCOME,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { status: "duplicate" };
    return { status: "error", message: error.message ?? "insert_failed" };
  }
  if (!data) return { status: "duplicate" };
  return { status: "claimed", deliveryId: data.id };
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
