/**
 * Server-only client for Resend's Receiving API.
 *
 * Resend's `email.received` webhook carries METADATA ONLY — it has no body,
 * no complete headers and no attachment content. The full message must be
 * fetched with the webhook's `data.email_id`:
 *
 *   GET https://api.resend.com/emails/receiving/:email_id
 *   Authorization: Bearer <RESEND_API_KEY>
 *
 * Contract enforced here:
 *  - fixed API origin, no caller-supplied host,
 *  - explicit timeout,
 *  - response size validation,
 *  - the API key and the email content are never logged,
 *  - errors are classified as retryable (network/timeout/429/5xx/404/auth)
 *    or permanent (malformed payload, oversized message).
 */

export const RESEND_API_ORIGIN = "https://api.resend.com";
export const RESEND_FETCH_TIMEOUT_MS = 15_000;
export const RESEND_MAX_EMAIL_BYTES = 2 * 1024 * 1024; // 2 MB

const EMAIL_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

export type ReceivedAttachmentMeta = {
  id: string | null;
  filename: string | null;
  contentType: string | null;
  sizeBytes: number | null;
};

export type ReceivedEmail = {
  id: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string | null;
  messageIdHeader: string | null;
  /**
   * Attachment METADATA only. Attachment content is never downloaded, because
   * the current job-lead ingest has no attachment pipeline.
   */
  attachments: ReceivedAttachmentMeta[];
};

export type FetchFailureKind = "retryable" | "permanent";

export type FetchReceivedEmailResult =
  | { ok: true; email: ReceivedEmail }
  | { ok: false; kind: FetchFailureKind; reason: string };

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

export function messageIdFromHeaders(headers: unknown): string | null {
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      const name = typeof rec["name"] === "string" ? rec["name"].toLowerCase() : "";
      if (name === "message-id" && typeof rec["value"] === "string") {
        return rec["value"].trim() || null;
      }
    }
    return null;
  }
  if (headers && typeof headers === "object") {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      if (key.toLowerCase() === "message-id" && typeof value === "string") {
        return value.trim() || null;
      }
    }
  }
  return null;
}

function readAttachments(value: unknown): ReceivedAttachmentMeta[] {
  if (!Array.isArray(value)) return [];
  const out: ReceivedAttachmentMeta[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    out.push({
      id: typeof rec["id"] === "string" ? rec["id"] : null,
      filename: typeof rec["filename"] === "string" ? rec["filename"] : null,
      contentType:
        typeof rec["content_type"] === "string"
          ? rec["content_type"]
          : typeof rec["contentType"] === "string"
            ? rec["contentType"]
            : null,
      sizeBytes: typeof rec["size"] === "number" ? rec["size"] : null,
    });
  }
  return out;
}

export function parseReceivedEmailPayload(
  payload: unknown,
  fallbackId: string,
): { ok: true; email: ReceivedEmail } | { ok: false; reason: string } {
  if (!payload || typeof payload !== "object") return { ok: false, reason: "invalid_payload" };
  const root = payload as Record<string, unknown>;
  const d =
    root["data"] && typeof root["data"] === "object"
      ? (root["data"] as Record<string, unknown>)
      : root;

  const to = firstString(d["to"]);
  if (!to) return { ok: false, reason: "invalid_payload" };
  const text = typeof d["text"] === "string" ? d["text"] : "";
  const html = typeof d["html"] === "string" && d["html"] ? d["html"] : null;
  if (!text && !html) return { ok: false, reason: "empty_message_body" };

  return {
    ok: true,
    email: {
      id: typeof d["id"] === "string" && d["id"] ? d["id"] : fallbackId,
      from: firstString(d["from"]) ?? "unknown@unknown",
      to,
      subject: typeof d["subject"] === "string" ? d["subject"] : "",
      text,
      html,
      messageIdHeader:
        messageIdFromHeaders(d["headers"]) ??
        (typeof d["message_id"] === "string" ? d["message_id"].trim() || null : null),
      attachments: readAttachments(d["attachments"]),
    },
  };
}

/**
 * Fetches the full received email. Never logs the key or the message.
 */
export async function fetchReceivedEmail(input: {
  emailId: string;
  apiKey: string;
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
}): Promise<FetchReceivedEmailResult> {
  const emailId = input.emailId.trim();
  if (!EMAIL_ID_RE.test(emailId))
    return { ok: false, kind: "permanent", reason: "invalid_email_id" };

  const doFetch = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? RESEND_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await doFetch(
      `${RESEND_API_ORIGIN}/emails/receiving/${encodeURIComponent(emailId)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${input.apiKey}`, Accept: "application/json" },
        redirect: "manual",
        signal: controller.signal,
      },
    );
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { ok: false, kind: "retryable", reason: aborted ? "fetch_timeout" : "fetch_failed" };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const status = response.status;
    if (status === 429 || status >= 500 || status === 404 || status === 401 || status === 403) {
      return { ok: false, kind: "retryable", reason: `resend_api_${status}` };
    }
    return { ok: false, kind: "permanent", reason: `resend_api_${status}` };
  }

  const maxBytes = input.maxBytes ?? RESEND_MAX_EMAIL_BYTES;
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, kind: "permanent", reason: "email_too_large" };
  }

  let body: string;
  try {
    body = await response.text();
  } catch {
    return { ok: false, kind: "retryable", reason: "fetch_body_failed" };
  }
  if (Buffer.byteLength(body, "utf8") > maxBytes) {
    return { ok: false, kind: "permanent", reason: "email_too_large" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return { ok: false, kind: "permanent", reason: "invalid_json" };
  }

  const parsed = parseReceivedEmailPayload(payload, emailId);
  if (!parsed.ok) return { ok: false, kind: "permanent", reason: parsed.reason };
  return { ok: true, email: parsed.email };
}
