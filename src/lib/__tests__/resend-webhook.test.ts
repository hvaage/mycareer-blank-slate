import { createHmac, randomBytes } from "crypto";
import { describe, expect, it } from "vitest";
import {
  parseResendInboundEvent,
  readSvixHeaders,
  verifyResendWebhook,
} from "@/lib/job-leads/resend-webhook.server";

const SECRET_BYTES = randomBytes(32);
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;
const NOW = 1_780_000_000;

function sign(id: string, timestamp: number, body: string, secret = SECRET_BYTES): string {
  const mac = createHmac("sha256", secret).update(`${id}.${timestamp}.${body}`).digest("base64");
  return `v1,${mac}`;
}

const EVENT_ID = "msg_2abcDEF";
const BODY = JSON.stringify({
  type: "email.received",
  created_at: "2026-09-11T08:00:00.000Z",
  data: {
    from: "jobb@finn.no",
    to: ["abcdefghijklmnopqrstuvwxyz@jobb.karrierenmin.no"],
    subject: "Ny stilling",
    text: "Innhold",
    html: "<p>Innhold</p>",
    headers: [
      { name: "Message-ID", value: "<abc@finn.no>" },
      { name: "X-Other", value: "ignored" },
    ],
  },
});

function headers(overrides: Partial<Record<string, string>> = {}) {
  return {
    id: EVENT_ID,
    timestamp: String(NOW),
    signature: sign(EVENT_ID, NOW, BODY),
    ...overrides,
  } as { id: string | null; timestamp: string | null; signature: string | null };
}

describe("readSvixHeaders", () => {
  it("reads both svix-* and webhook-* header names", () => {
    expect(
      readSvixHeaders(
        new Headers({ "svix-id": " a ", "svix-timestamp": "1", "svix-signature": "v1,x" }),
      ),
    ).toEqual({ id: "a", timestamp: "1", signature: "v1,x" });
    expect(
      readSvixHeaders(
        new Headers({ "webhook-id": "b", "webhook-timestamp": "2", "webhook-signature": "v1,y" }),
      ),
    ).toEqual({ id: "b", timestamp: "2", signature: "v1,y" });
    expect(readSvixHeaders(new Headers())).toEqual({
      id: null,
      timestamp: null,
      signature: null,
    });
  });
});

describe("verifyResendWebhook", () => {
  it("accepts a correctly signed delivery and returns the stable event id", async () => {
    const result = await verifyResendWebhook({
      headers: headers(),
      rawBody: BODY,
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: true, eventId: EVENT_ID });
  });

  it("accepts a secret given without the whsec_ prefix", async () => {
    const result = await verifyResendWebhook({
      headers: headers(),
      rawBody: BODY,
      secret: SECRET_BYTES.toString("base64"),
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: true, eventId: EVENT_ID });
  });

  it("accepts when one of several signatures matches (key rotation)", async () => {
    const other = randomBytes(32);
    const result = await verifyResendWebhook({
      headers: headers({
        signature: `${sign(EVENT_ID, NOW, BODY, other)} ${sign(EVENT_ID, NOW, BODY)}`,
      }),
      rawBody: BODY,
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const result = await verifyResendWebhook({
      headers: headers(),
      rawBody: BODY.replace("Ny stilling", "Forfalsket"),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("rejects a re-serialized body even when semantically equal", async () => {
    const reserialized = JSON.stringify(JSON.parse(BODY), null, 2);
    const result = await verifyResendWebhook({
      headers: headers(),
      rawBody: reserialized,
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a signature made with another secret", async () => {
    const result = await verifyResendWebhook({
      headers: headers({ signature: sign(EVENT_ID, NOW, BODY, randomBytes(32)) }),
      rawBody: BODY,
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("rejects a signature bound to a different event id or timestamp", async () => {
    await expect(
      verifyResendWebhook({
        headers: headers({ id: "msg_other" }),
        rawBody: BODY,
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid_signature" });
    await expect(
      verifyResendWebhook({
        headers: headers({ timestamp: String(NOW - 10) }),
        rawBody: BODY,
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid_signature" });
  });

  it.each([
    [{ id: null }, "missing_headers"],
    [{ timestamp: null }, "missing_headers"],
    [{ signature: null }, "missing_headers"],
    [{ timestamp: "not-a-number" }, "invalid_timestamp"],
    [{ signature: "v0,abc" }, "invalid_signature"],
    [{ signature: "garbage" }, "invalid_signature"],
    [{ signature: "" }, "missing_headers"],
  ])("rejects %o with %s", async (override, reason) => {
    const result = await verifyResendWebhook({
      headers: headers(override as Record<string, string>),
      rawBody: BODY,
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(result).toEqual({ ok: false, reason });
  });

  it("rejects replays outside the timestamp tolerance in both directions", async () => {
    await expect(
      verifyResendWebhook({
        headers: headers(),
        rawBody: BODY,
        secret: SECRET,
        nowSeconds: NOW + 301,
      }),
    ).resolves.toEqual({ ok: false, reason: "timestamp_out_of_tolerance" });
    await expect(
      verifyResendWebhook({
        headers: headers(),
        rawBody: BODY,
        secret: SECRET,
        nowSeconds: NOW - 301,
      }),
    ).resolves.toEqual({ ok: false, reason: "timestamp_out_of_tolerance" });
  });

  it("accepts a legitimate provider retry inside the tolerance window", async () => {
    const result = await verifyResendWebhook({
      headers: headers(),
      rawBody: BODY,
      secret: SECRET,
      nowSeconds: NOW + 290,
    });
    expect(result).toEqual({ ok: true, eventId: EVENT_ID });
  });

  it("fails closed on an unusable secret", async () => {
    for (const secret of ["", "whsec_", "   "]) {
      const result = await verifyResendWebhook({
        headers: headers(),
        rawBody: BODY,
        secret,
        nowSeconds: NOW,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_secret" });
    }
  });
});

describe("parseResendInboundEvent", () => {
  it("parses the documented received-email event", () => {
    const result = parseResendInboundEvent(BODY);
    expect(result).toEqual({
      ok: true,
      email: {
        from: "jobb@finn.no",
        to: "abcdefghijklmnopqrstuvwxyz@jobb.karrierenmin.no",
        subject: "Ny stilling",
        text: "Innhold",
        html: "<p>Innhold</p>",
        messageIdHeader: "<abc@finn.no>",
      },
    });
  });

  it("accepts object-shaped headers and a string recipient", () => {
    const result = parseResendInboundEvent(
      JSON.stringify({
        type: "email.received",
        data: {
          from: "a@b.no",
          to: "c@d.no",
          subject: "S",
          text: "T",
          headers: { "message-id": "<x@y>" },
        },
      }),
    );
    expect(result.ok && result.email.messageIdHeader).toBe("<x@y>");
    expect(result.ok && result.email.to).toBe("c@d.no");
    expect(result.ok && result.email.html).toBeNull();
  });

  it("ignores other event types", () => {
    expect(parseResendInboundEvent(JSON.stringify({ type: "email.delivered", data: {} }))).toEqual({
      ok: false,
      reason: "unsupported_event_type",
    });
  });

  it("rejects invalid JSON and payloads without a recipient", () => {
    expect(parseResendInboundEvent("{not json")).toEqual({ ok: false, reason: "invalid_json" });
    expect(
      parseResendInboundEvent(JSON.stringify({ type: "email.received", data: { from: "a@b.no" } })),
    ).toEqual({ ok: false, reason: "invalid_payload" });
    expect(parseResendInboundEvent(JSON.stringify({ type: "email.received" }))).toEqual({
      ok: false,
      reason: "invalid_payload",
    });
  });
});
