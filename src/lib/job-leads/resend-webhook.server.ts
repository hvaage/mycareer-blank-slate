/**
 * Server-only Resend inbound webhook contract.
 *
 * Resend signs webhooks with Svix (the "Standard Webhooks" scheme):
 *   signed content = `${svix-id}.${svix-timestamp}.${raw body}`
 *   signature      = base64(HMAC-SHA256(base64decode(secret without `whsec_`), signed content))
 * The `svix-signature` header carries a space-separated list of
 * `v1,<base64>` entries; any matching entry verifies the delivery.
 *
 * The RAW request body must be used — never a re-serialized JSON object.
 */

import { timingSafeEqual } from "crypto";

export const SVIX_TOLERANCE_SECONDS = 5 * 60;

export type SvixHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

/** Svix sends both the legacy `svix-*` and the standard `webhook-*` headers. */
export function readSvixHeaders(headers: Headers): SvixHeaders {
  const pick = (a: string, b: string) => {
    const v = headers.get(a) ?? headers.get(b);
    const t = (v ?? "").trim();
    return t ? t : null;
  };
  return {
    id: pick("svix-id", "webhook-id"),
    timestamp: pick("svix-timestamp", "webhook-timestamp"),
    signature: pick("svix-signature", "webhook-signature"),
  };
}

export type VerifyFailure =
  | "missing_headers"
  | "invalid_timestamp"
  | "timestamp_out_of_tolerance"
  | "invalid_secret"
  | "invalid_signature";

export type VerifyResult = { ok: true; eventId: string } | { ok: false; reason: VerifyFailure };

function decodeSecret(secret: string): Uint8Array<ArrayBuffer> | null {
  const raw = secret.trim();
  if (!raw) return null;
  const body = raw.startsWith("whsec_") ? raw.slice("whsec_".length) : raw;
  if (!body) return null;
  try {
    const bin = atob(body);
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function equalsConstantTime(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifies a Resend/Svix webhook over the raw body. Returns the stable event
 * id (`svix-id`) on success — Svix reuses it for every retry of the same
 * message, which makes it a safe identity component.
 */
export async function verifyResendWebhook(input: {
  headers: SvixHeaders;
  rawBody: string;
  secret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): Promise<VerifyResult> {
  const { id, timestamp, signature } = input.headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };

  if (!/^\d{1,15}$/.test(timestamp)) return { ok: false, reason: "invalid_timestamp" };
  const ts = Number(timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? SVIX_TOLERANCE_SECONDS;
  if (Math.abs(now - ts) > tolerance) return { ok: false, reason: "timestamp_out_of_tolerance" };

  const key = decodeSecret(input.secret);
  if (!key) return { ok: false, reason: "invalid_secret" };

  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(`${id}.${timestamp}.${input.rawBody}`),
  );
  const expected = Buffer.from(new Uint8Array(mac)).toString("base64");

  const candidates = signature
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part.startsWith("v1,"))
    .map((part) => part.slice(3));

  if (candidates.length === 0) return { ok: false, reason: "invalid_signature" };
  const matched = candidates.some((candidate) => equalsConstantTime(candidate, expected));
  if (!matched) return { ok: false, reason: "invalid_signature" };

  return { ok: true, eventId: id };
}

export const RESEND_INBOUND_EVENT_TYPE = "email.received";

/**
 * The `email.received` webhook is METADATA ONLY. It carries no body, no
 * complete headers and no attachment content — those must be fetched from
 * Resend's Receiving API with `email_id`.
 */
export type ResendInboundMetadata = {
  emailId: string;
  from: string;
  to: string;
  subject: string;
};

export type ParseEventResult =
  | { ok: true; metadata: ResendInboundMetadata }
  | { ok: false; reason: "invalid_json" | "unsupported_event_type" | "invalid_payload" };

function firstString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const s = firstString(item);
      if (s) return s;
    }
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const s = firstString(rec["address"] ?? rec["email"]);
    if (s) return s;
  }
  return null;
}

/**
 * Parses the documented Resend inbound event. Only `email.received` is
 * accepted; any other event type is ignored rather than ingested.
 */
export function parseResendInboundEvent(rawBody: string): ParseEventResult {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!payload || typeof payload !== "object") return { ok: false, reason: "invalid_payload" };
  const event = payload as Record<string, unknown>;
  if (event["type"] !== RESEND_INBOUND_EVENT_TYPE) {
    return { ok: false, reason: "unsupported_event_type" };
  }
  const data = event["data"];
  if (!data || typeof data !== "object") return { ok: false, reason: "invalid_payload" };
  const d = data as Record<string, unknown>;

  const emailId = firstString(d["email_id"] ?? d["id"]);
  if (!emailId) return { ok: false, reason: "invalid_payload" };
  const to = firstString(d["to"]);
  if (!to) return { ok: false, reason: "invalid_payload" };

  return {
    ok: true,
    metadata: {
      emailId,
      to,
      from: firstString(d["from"]) ?? "unknown@unknown",
      subject: typeof d["subject"] === "string" ? d["subject"] : "",
    },
  };
}
