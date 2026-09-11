/**
 * Route-level regression for the metadata-only Resend inbound webhook.
 *
 * Verifies that the full email is fetched from Resend's Receiving API AFTER a
 * successful atomic claim — and never for an invalid signature, a duplicate or
 * a live lease.
 */
import { createHmac, randomBytes } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET_BYTES = randomBytes(32);
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;
const DOMAIN = "jobb.karrierenmin.no";
const ALIAS = "abcdefghijklmnopqrstuvwxyz";
const EMAIL_ID = "6229f547-f3a1-4de6-8e26-1b6b5e2e1b7a";
const EVENT_ID = "msg_2abcDEF";

vi.stubEnv("INBOUND_EMAIL_DOMAIN", DOMAIN);
vi.stubEnv("RESEND_WEBHOOK_SECRET", SECRET);
vi.stubEnv("RESEND_API_KEY", "re_test");

type ClaimStatus = "claimed" | "duplicate" | "in_progress";
const state: {
  claimStatus: ClaimStatus;
  finalizes: Array<{ outcome: string; reason: string | null }>;
} = { claimStatus: "claimed", finalizes: [] };

function chain(result: unknown) {
  const target = {
    select: () => chain(result),
    insert: () => chain(result),
    update: () => chain(result),
    eq: () => chain(result),
    gte: () => chain(result),
    not: () => chain(result),
    limit: () => chain(result),
    single: async () => result,
    maybeSingle: async () => result,
    then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res),
  };
  return target as never;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "email_job_sources") {
        return chain({
          data: {
            id: "source-1",
            user_id: "user-1",
            source_system: "finn",
            intake_mode: "forwarding",
            email_connection_id: null,
            is_active: true,
          },
          error: null,
        });
      }
      return chain({ data: { id: "rate-1" }, count: 0, error: null });
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "inbound_email_claim_delivery") {
        return {
          data: [
            {
              status: state.claimStatus,
              delivery_id: "delivery-1",
              claim_token: state.claimStatus === "claimed" ? "token-1" : null,
              attempt_number: 1,
            },
          ],
          error: null,
        };
      }
      state.finalizes.push({
        outcome: String(args["p_outcome"]),
        reason: (args["p_reject_reason"] as string | null) ?? null,
      });
      return { data: [{ status: "finalized" }], error: null };
    },
  },
}));

const ingestSpy = vi.fn(async () => ({ importedJobEmailId: "import-1", jobLeadId: "lead-1" }));
vi.mock("@/lib/job-leads/ingest", () => ({
  ingestParsedEmail: (...a: unknown[]) => ingestSpy(...(a as [])),
}));

const fetchSpy = vi.fn();
vi.mock("@/lib/job-leads/resend-receiving.server", () => ({
  fetchReceivedEmail: (...args: unknown[]) => fetchSpy(...(args as [])),
}));

const parseSpy = vi.fn();
vi.mock("@/lib/job-leads/parse", () => ({
  parseEmail: (...a: unknown[]) => parseSpy(...(a as [])),
}));

const { Route } = await import("@/routes/api/public/inbound/job-email");
const POST = (
  Route.options as never as {
    server: { handlers: { POST: (c: { request: Request }) => Promise<Response> } };
  }
).server.handlers.POST;

function body(): string {
  return JSON.stringify({
    type: "email.received",
    created_at: "2026-09-11T08:00:00.000Z",
    data: {
      email_id: EMAIL_ID,
      from: "jobb@finn.no",
      to: [`${ALIAS}@${DOMAIN}`],
      subject: "Ny stilling",
    },
  });
}

function request(raw: string, opts: { validSignature?: boolean } = {}): Request {
  const ts = Math.floor(Date.now() / 1000);
  const mac = createHmac("sha256", SECRET_BYTES)
    .update(`${EVENT_ID}.${ts}.${raw}`)
    .digest("base64");
  return new Request("https://karrierenmin.no/api/public/inbound/job-email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": EVENT_ID,
      "svix-timestamp": String(ts),
      "svix-signature": opts.validSignature === false ? "v1,AAAA" : `v1,${mac}`,
    },
    body: raw,
  });
}

const FETCHED = {
  ok: true as const,
  email: {
    id: EMAIL_ID,
    from: "jobb@finn.no",
    to: `${ALIAS}@${DOMAIN}`,
    subject: "Ny stilling",
    text: "Innhold fra Receiving API",
    html: "<p>Innhold</p>",
    messageIdHeader: "<abc@finn.no>",
    attachments: [],
  },
};

beforeEach(() => {
  state.claimStatus = "claimed";
  state.finalizes = [];
  fetchSpy.mockReset();
  parseSpy.mockReset();
  ingestSpy.mockClear();
  fetchSpy.mockResolvedValue(FETCHED);
  parseSpy.mockReturnValue({ ok: true, lead: { confidence: 0.9 } });
});

describe("inbound job-email route (Resend metadata-only contract)", () => {
  it("fetches the full email before parsing and only then accepts", async () => {
    const res = await POST({ request: request(body()) });
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]![0]).toMatchObject({ emailId: EMAIL_ID });
    // The parser sees the FETCHED body, never the webhook payload.
    expect(parseSpy.mock.calls[0]![0]).toMatchObject({ text: "Innhold fra Receiving API" });
    expect(ingestSpy).toHaveBeenCalledTimes(1);
    expect(state.finalizes).toEqual([{ outcome: "accepted", reason: null }]);
  });

  it("never calls the Resend API for an invalid signature", async () => {
    const res = await POST({ request: request(body(), { validSignature: false }) });
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never calls the Resend API for a duplicate or a live lease", async () => {
    for (const status of ["duplicate", "in_progress"] as const) {
      state.claimStatus = status;
      fetchSpy.mockClear();
      const res = await POST({ request: request(body()) });
      expect(res.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(state.finalizes).toEqual([]);
    }
  });

  it("finalizes a retryable fetch failure as ingest_failed", async () => {
    fetchSpy.mockResolvedValue({ ok: false, kind: "retryable", reason: "resend_api_429" });
    const res = await POST({ request: request(body()) });
    expect(res.status).toBe(502);
    expect(state.finalizes).toEqual([{ outcome: "ingest_failed", reason: "resend_api_429" }]);
  });

  it("finalizes a permanent fetch failure as parse_failed", async () => {
    fetchSpy.mockResolvedValue({ ok: false, kind: "permanent", reason: "email_too_large" });
    const res = await POST({ request: request(body()) });
    expect(res.status).toBe(422);
    expect(state.finalizes).toEqual([{ outcome: "parse_failed", reason: "email_too_large" }]);
  });

  it("finalizes a parse rejection as parse_failed and an ingest crash as ingest_failed", async () => {
    parseSpy.mockReturnValue({ ok: false, rejectReason: "not_a_job_email" });
    let res = await POST({ request: request(body()) });
    expect(res.status).toBe(422);
    expect(state.finalizes).toEqual([{ outcome: "parse_failed", reason: "not_a_job_email" }]);

    state.finalizes = [];
    parseSpy.mockReturnValue({ ok: true, lead: { confidence: 0.9 } });
    ingestSpy.mockRejectedValueOnce(new Error("db down"));
    res = await POST({ request: request(body()) });
    expect(res.status).toBe(500);
    expect(state.finalizes).toEqual([{ outcome: "ingest_failed", reason: "ingest_failed" }]);
  });
});
