import { describe, expect, it, vi } from "vitest";
import {
  RESEND_API_ORIGIN,
  fetchReceivedEmail,
  parseReceivedEmailPayload,
} from "@/lib/job-leads/resend-receiving.server";
import { generateAliasToken, ensureForwardingAlias } from "@/lib/job-leads/inbound-alias.server";
import { readInboundConfig, stableProviderMessageId } from "@/lib/job-leads/inbound-email.server";

const API_KEY = "re_test_key";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const FULL_EMAIL = {
  id: "6229f547-f3a1-4de6-8e26-1b6b5e2e1b7a",
  from: "jobb@finn.no",
  to: ["abcdefghijklmnopqrstuvwxyz@jobb.karrierenmin.no"],
  subject: "Ny stilling",
  text: "Innhold",
  html: "<p>Innhold</p>",
  headers: [{ name: "Message-ID", value: "<abc@finn.no>" }],
  attachments: [{ id: "att_1", filename: "cv.pdf", content_type: "application/pdf", size: 1234 }],
};

describe("Resend Receiving API client", () => {
  it("fetches the full email from the fixed Resend origin with a bearer key", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse(FULL_EMAIL);
    }) as unknown as typeof fetch;

    const result = await fetchReceivedEmail({ emailId: FULL_EMAIL.id, apiKey: API_KEY, fetchImpl });

    expect(calls[0]!.url).toBe(`${RESEND_API_ORIGIN}/emails/receiving/${FULL_EMAIL.id}`);
    expect(
      (calls[0]!.init!.headers as Record<string, string>)["Authorization"],
    ).toBe(`Bearer ${API_KEY}`);
    expect(result.ok && result.email.text).toBe("Innhold");
    expect(result.ok && result.email.html).toBe("<p>Innhold</p>");
    expect(result.ok && result.email.messageIdHeader).toBe("<abc@finn.no>");
    // Attachment METADATA only — content is never downloaded.
    expect(result.ok && result.email.attachments).toEqual([
      { id: "att_1", filename: "cv.pdf", contentType: "application/pdf", sizeBytes: 1234 },
    ]);
  });

  it("classifies 429 and 5xx as retryable", async () => {
    for (const status of [429, 500, 502, 503]) {
      const fetchImpl = vi.fn(async () =>
        jsonResponse({ error: "x" }, { status }),
      ) as unknown as typeof fetch;
      const result = await fetchReceivedEmail({ emailId: FULL_EMAIL.id, apiKey: API_KEY, fetchImpl });
      expect(result).toEqual({ ok: false, kind: "retryable", reason: `resend_api_${status}` });
    }
  });

  it("classifies auth and not-found as retryable, other 4xx as permanent", async () => {
    for (const status of [401, 403, 404]) {
      const fetchImpl = vi.fn(async () =>
        jsonResponse({}, { status }),
      ) as unknown as typeof fetch;
      const r = await fetchReceivedEmail({ emailId: FULL_EMAIL.id, apiKey: API_KEY, fetchImpl });
      expect(r.ok === false && r.kind).toBe("retryable");
    }
    const fetchImpl = vi.fn(async () => jsonResponse({}, { status: 422 })) as unknown as typeof fetch;
    const r = await fetchReceivedEmail({ emailId: FULL_EMAIL.id, apiKey: API_KEY, fetchImpl });
    expect(r).toEqual({ ok: false, kind: "permanent", reason: "resend_api_422" });
  });

  it("treats a timeout as retryable and never leaks the key", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (init?.signal?.aborted) {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }
      return jsonResponse(FULL_EMAIL);
    }) as unknown as typeof fetch;

    const result = await fetchReceivedEmail({
      emailId: FULL_EMAIL.id,
      apiKey: API_KEY,
      timeoutMs: 5,
      fetchImpl,
    });
    expect(result).toEqual({ ok: false, kind: "retryable", reason: "fetch_timeout" });
  });

  it("rejects oversized responses and malformed payloads permanently", async () => {
    const big = jsonResponse({ ...FULL_EMAIL, text: "x".repeat(4000) });
    const fetchBig = vi.fn(async () => big) as unknown as typeof fetch;
    const oversized = await fetchReceivedEmail({
      emailId: FULL_EMAIL.id,
      apiKey: API_KEY,
      maxBytes: 100,
      fetchImpl: fetchBig,
    });
    expect(oversized).toEqual({ ok: false, kind: "permanent", reason: "email_too_large" });

    const fetchBad = vi.fn(
      async () => new Response("not json", { status: 200 }),
    ) as unknown as typeof fetch;
    const bad = await fetchReceivedEmail({ emailId: FULL_EMAIL.id, apiKey: API_KEY, fetchImpl: fetchBad });
    expect(bad).toEqual({ ok: false, kind: "permanent", reason: "invalid_json" });
  });

  it("rejects an unusable email id without any network call", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await fetchReceivedEmail({ emailId: "bad id!", apiKey: API_KEY, fetchImpl });
    expect(result).toEqual({ ok: false, kind: "permanent", reason: "invalid_email_id" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires a usable body", () => {
    expect(parseReceivedEmailPayload({ to: "a@b.no" }, "id123456")).toEqual({
      ok: false,
      reason: "empty_message_body",
    });
    expect(parseReceivedEmailPayload({ data: { to: "a@b.no", text: "t" } }, "id123456")).toMatchObject(
      { ok: true },
    );
  });
});

describe("inbound configuration gate", () => {
  const base = {
    INBOUND_EMAIL_DOMAIN: "jobb.karrierenmin.no",
    RESEND_WEBHOOK_SECRET: "whsec_abc",
    RESEND_API_KEY: "re_x",
  };

  it("is open only with all three server settings", () => {
    expect(readInboundConfig(base)).toEqual({
      ok: true,
      config: {
        domain: "jobb.karrierenmin.no",
        resendWebhookSecret: "whsec_abc",
        resendApiKey: "re_x",
      },
    });
    expect(readInboundConfig({ ...base, RESEND_API_KEY: "" })).toEqual({
      ok: false,
      reason: "missing_api_key",
    });
    expect(readInboundConfig({ ...base, RESEND_WEBHOOK_SECRET: "" })).toEqual({
      ok: false,
      reason: "missing_webhook_secret",
    });
    expect(readInboundConfig({ ...base, INBOUND_EMAIL_DOMAIN: "" })).toEqual({
      ok: false,
      reason: "missing_inbound_domain",
    });
  });
});

describe("stable message identity", () => {
  it("prefers Message-ID, then Resend email id, then the Svix event id", () => {
    const a = stableProviderMessageId({
      messageIdHeader: "<abc@finn.no>",
      resendEmailId: "e1",
      eventId: "msg_1",
      from: "a@b.no",
      to: "c@d.no",
      subject: "s",
      bodyText: "t",
    });
    const b = stableProviderMessageId({
      resendEmailId: "e1",
      eventId: "msg_2",
      from: "a@b.no",
      to: "c@d.no",
      subject: "s",
      bodyText: "",
    });
    const c = stableProviderMessageId({
      resendEmailId: "e1",
      eventId: "msg_9",
      from: "z@z.no",
      to: "c@d.no",
      subject: "annet",
      bodyText: "helt annet",
    });
    expect(b).toBe(c); // email id wins over any surrounding metadata
    expect(a).not.toBe(b);
  });
});

describe("forwarding alias provisioning", () => {
  it("generates an unguessable base32 token accepted by the database rule", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const t = generateAliasToken();
      expect(t).toMatch(/^[a-z2-7]{26,64}$/);
      tokens.add(t);
    }
    expect(tokens.size).toBe(200);
  });

  it("never derives the alias from the user id or e-mail", () => {
    const userId = "3f2ad0b7-4a9f-4b02-9b64-0f8b1a2c3d4e";
    const token = generateAliasToken();
    expect(token).not.toContain(userId.replace(/-/g, ""));
    expect(token).not.toContain("henrik");
  });

  it("returns the existing alias without creating a second one", async () => {
    const inserts: unknown[] = [];
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { inbound_alias_token: "existing".padEnd(30, "a") }, error: null }),
            }),
          }),
        }),
        insert: (values: Record<string, unknown>) => {
          inserts.push(values);
          return { select: () => ({ single: async () => ({ data: null, error: { code: "x" } }) }) };
        },
      }),
    };
    const result = await ensureForwardingAlias(admin as never, "user-1");
    expect(result).toEqual({ ok: true, token: "existing".padEnd(30, "a"), created: false });
    expect(inserts).toHaveLength(0);
  });

  it("creates a bound row for the verified user when none exists", async () => {
    let existing: string | null = null;
    const inserted: Record<string, unknown>[] = [];
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { inbound_alias_token: existing }, error: null }) }),
          }),
        }),
        insert: (values: Record<string, unknown>) => {
          inserted.push(values);
          existing = values["inbound_alias_token"] as string;
          return {
            select: () => ({
              single: async () => ({ data: { inbound_alias_token: existing }, error: null }),
            }),
          };
        },
      }),
    };
    const result = await ensureForwardingAlias(admin as never, "user-2");
    expect(result.ok && result.created).toBe(true);
    expect(inserted[0]).toMatchObject({
      user_id: "user-2",
      intake_mode: "forwarding",
      is_active: true,
    });
    expect(String(inserted[0]!["inbound_alias_token"])).toMatch(/^[a-z2-7]{26,64}$/);
  });
});
