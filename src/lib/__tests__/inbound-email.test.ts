import { describe, expect, it } from "vitest";
import {
  aliasTokenForRecipient,
  claimInboundDelivery,
  finalizeInboundDelivery,
  fromDomain,
  readInboundConfig,
  stableProviderMessageId,
} from "@/lib/job-leads/inbound-email.server";

const ALIAS = "abcdefghijklmnopqrstuvwxyz";
const DOMAIN = "jobb.karrierenmin.no";

describe("readInboundConfig", () => {
  it("stays off without an inbound domain", () => {
    expect(readInboundConfig({ MAILGUN_WEBHOOK_SIGNING_KEY: "k" })).toEqual({
      ok: false,
      reason: "missing_inbound_domain",
    });
  });

  it("stays off without the Mailgun signing key", () => {
    expect(readInboundConfig({ INBOUND_EMAIL_DOMAIN: DOMAIN })).toEqual({
      ok: false,
      reason: "missing_webhook_secret",
    });
  });

  it("does not accept LOVABLE_API_KEY as a webhook secret", () => {
    const result = readInboundConfig({
      INBOUND_EMAIL_DOMAIN: DOMAIN,
      LOVABLE_API_KEY: "lovable-key",
    });
    expect(result).toEqual({ ok: false, reason: "missing_webhook_secret" });
  });

  it("is configured when both values are present", () => {
    const result = readInboundConfig({
      INBOUND_EMAIL_DOMAIN: ` ${DOMAIN.toUpperCase()} `,
      MAILGUN_WEBHOOK_SIGNING_KEY: " key ",
    });
    expect(result).toEqual({
      ok: true,
      config: { domain: DOMAIN, mailgunSigningKey: "key" },
    });
  });
});

describe("aliasTokenForRecipient", () => {
  it("accepts an alias on the configured domain", () => {
    expect(aliasTokenForRecipient(`${ALIAS}@${DOMAIN}`, DOMAIN)).toBe(ALIAS);
    expect(aliasTokenForRecipient(`  ${ALIAS.toUpperCase()}@${DOMAIN}  `, DOMAIN)).toBe(ALIAS);
  });

  it.each([
    [`${ALIAS}@karrierenmin.no`, "superdomain"],
    [`${ALIAS}@mail.jobb.karrierenmin.no`, "subdomain"],
    [`${ALIAS}@jobb.karrierenmin.no.evil.com`, "suffix attack"],
    [`${ALIAS}@evil.com`, "foreign domain"],
    [`${ALIAS}+extra@${DOMAIN}`, "plus addressing"],
    [`short@${DOMAIN}`, "too short"],
    [`ABC!DEF@${DOMAIN}`, "illegal characters"],
    [`${ALIAS}`, "no domain"],
    [`@${DOMAIN}`, "empty local part"],
    [`${ALIAS}@`, "empty domain"],
  ])("rejects %s (%s)", (recipient) => {
    expect(aliasTokenForRecipient(recipient, DOMAIN)).toBeNull();
  });
});

describe("fromDomain", () => {
  it("extracts and lowercases the sender domain", () => {
    expect(fromDomain("Jobb@FINN.NO")).toBe("finn.no");
    expect(fromDomain("broken")).toBeNull();
  });
});

describe("stableProviderMessageId", () => {
  const base = {
    from: "jobb@finn.no",
    to: `${ALIAS}@${DOMAIN}`,
    subject: "Ny stilling",
    bodyText: "Innhold",
    bodyHtml: null,
  };

  it("is stable across redeliveries of the same message", () => {
    expect(stableProviderMessageId({ ...base, messageIdHeader: "<abc@finn.no>" })).toBe(
      stableProviderMessageId({ ...base, messageIdHeader: "<abc@finn.no>" }),
    );
  });

  it("prefers the Message-Id header over content", () => {
    const withHeader = stableProviderMessageId({ ...base, messageIdHeader: "<abc@finn.no>" });
    const otherBody = stableProviderMessageId({
      ...base,
      bodyText: "Helt annet innhold",
      messageIdHeader: "<abc@finn.no>",
    });
    expect(withHeader).toBe(otherBody);
  });

  it("falls back to immutable content only, never receive time", () => {
    const a = stableProviderMessageId({ ...base, messageIdHeader: null });
    const b = stableProviderMessageId({ ...base, messageIdHeader: "  " });
    expect(a).toBe(b);
    expect(a).not.toBe(stableProviderMessageId({ ...base, subject: "Annen tittel" }));
  });
});

/**
 * In-memory stand-in for the database state machine implemented by
 * inbound_email_claim_delivery / inbound_email_finalize_delivery.
 */
function makeAdmin(now = () => Date.now()) {
  type Row = {
    id: string;
    key: string;
    outcome: string;
    claim_token: string | null;
    lease_expires_at: number | null;
    attempt_count: number;
    imported_job_email_id: string | null;
  };
  const rows = new Map<string, Row>();
  let nextId = 0;
  let nextToken = 0;
  const calls: { fn: string; args: Record<string, unknown> }[] = [];

  return {
    rows,
    calls,
    async rpc(fn: string, args: Record<string, unknown>) {
      // Yield so concurrent callers interleave before the state check.
      await Promise.resolve();
      calls.push({ fn, args });

      if (fn === "inbound_email_claim_delivery") {
        const key = `${args.p_email_job_source_id}|${args.p_provider}|${args.p_provider_message_id}`;
        const lease = Number(args.p_lease_seconds ?? 300) * 1000;
        const existing = rows.get(key);
        if (!existing) {
          nextId += 1;
          nextToken += 1;
          const token = `token-${nextToken}`;
          rows.set(key, {
            id: `delivery-${nextId}`,
            key,
            outcome: "processing",
            claim_token: token,
            lease_expires_at: now() + lease,
            attempt_count: 1,
            imported_job_email_id: null,
          });
          return {
            data: [
              {
                status: "claimed",
                delivery_id: `delivery-${nextId}`,
                claim_token: token,
                attempt_number: 1,
              },
            ],
            error: null,
          };
        }
        if (existing.outcome === "accepted") {
          return {
            data: [{ status: "duplicate", delivery_id: existing.id, claim_token: null }],
            error: null,
          };
        }
        if (existing.outcome === "processing" && (existing.lease_expires_at ?? 0) > now()) {
          return {
            data: [{ status: "in_progress", delivery_id: existing.id, claim_token: null }],
            error: null,
          };
        }
        nextToken += 1;
        const token = `token-${nextToken}`;
        existing.outcome = "processing";
        existing.claim_token = token;
        existing.lease_expires_at = now() + lease;
        existing.attempt_count += 1;
        return {
          data: [
            {
              status: "claimed",
              delivery_id: existing.id,
              claim_token: token,
              attempt_number: existing.attempt_count,
            },
          ],
          error: null,
        };
      }

      if (fn === "inbound_email_finalize_delivery") {
        const row = [...rows.values()].find((r) => r.id === args.p_delivery_id);
        if (!row) return { data: [{ status: "not_found" }], error: null };
        if (row.outcome !== "processing" || row.claim_token !== args.p_claim_token) {
          return { data: [{ status: "lease_lost" }], error: null };
        }
        row.outcome = String(args.p_outcome);
        row.claim_token = null;
        row.lease_expires_at = null;
        row.imported_job_email_id = (args.p_imported_job_email_id as string | null) ?? null;
        return { data: [{ status: "finalized", outcome: row.outcome }], error: null };
      }

      return { data: null, error: { message: `unknown rpc ${fn}` } };
    },
  };
}

const claimValues = {
  user_id: "user-1",
  email_job_source_id: "source-1",
  alias_token: ALIAS,
  provider_message_id: "msg-1",
  from_domain: "finn.no",
  size_bytes: 100,
};

async function succeed(admin: ReturnType<typeof makeAdmin>) {
  const claim = await claimInboundDelivery(admin as never, claimValues);
  if (claim.status !== "claimed") throw new Error(`expected claim, got ${claim.status}`);
  return finalizeInboundDelivery(admin as never, {
    deliveryId: claim.deliveryId,
    claimToken: claim.claimToken,
    outcome: "accepted",
    importedJobEmailId: "import-1",
  });
}

describe("claimInboundDelivery", () => {
  it("claims through the atomic database function with the right arguments", async () => {
    const admin = makeAdmin();
    await claimInboundDelivery(admin as never, claimValues);
    expect(admin.calls[0].fn).toBe("inbound_email_claim_delivery");
    expect(admin.calls[0].args.p_provider).toBe("mailgun");
  });

  it("reserves as processing, not accepted, before ingest", async () => {
    const admin = makeAdmin();
    await claimInboundDelivery(admin as never, claimValues);
    expect([...admin.rows.values()][0].outcome).toBe("processing");
  });

  it("reports replays after success as duplicates", async () => {
    const admin = makeAdmin();
    await succeed(admin);
    const replay = await claimInboundDelivery(admin as never, claimValues);
    expect(replay.status).toBe("duplicate");
  });

  it("reports a live concurrent lease as in_progress", async () => {
    const admin = makeAdmin();
    await claimInboundDelivery(admin as never, claimValues);
    const replay = await claimInboundDelivery(admin as never, claimValues);
    expect(replay.status).toBe("in_progress");
  });

  it("lets exactly one of many concurrent webhooks proceed to ingest", async () => {
    const admin = makeAdmin();
    const results = await Promise.all(
      Array.from({ length: 25 }, async () => {
        const claim = await claimInboundDelivery(admin as never, claimValues);
        return claim.status;
      }),
    );
    expect(results.filter((s) => s === "claimed")).toHaveLength(1);
    expect(results.filter((s) => s !== "claimed")).toHaveLength(24);
    expect(admin.rows.size).toBe(1);
  });

  it("allows a retry after ingest_failed and then terminal accepted", async () => {
    const admin = makeAdmin();
    const first = await claimInboundDelivery(admin as never, claimValues);
    if (first.status !== "claimed") throw new Error("expected claim");
    await finalizeInboundDelivery(admin as never, {
      deliveryId: first.deliveryId,
      claimToken: first.claimToken,
      outcome: "ingest_failed",
      rejectReason: "ingest_failed",
    });
    const retry = await claimInboundDelivery(admin as never, claimValues);
    expect(retry.status).toBe("claimed");
    expect(await succeedFrom(admin, retry)).toEqual({ status: "finalized", outcome: "accepted" });
    expect((await claimInboundDelivery(admin as never, claimValues)).status).toBe("duplicate");
  });

  it("allows a retry after parse_failed", async () => {
    const admin = makeAdmin();
    const first = await claimInboundDelivery(admin as never, claimValues);
    if (first.status !== "claimed") throw new Error("expected claim");
    await finalizeInboundDelivery(admin as never, {
      deliveryId: first.deliveryId,
      claimToken: first.claimToken,
      outcome: "parse_failed",
      rejectReason: "not_a_job",
    });
    const retry = await claimInboundDelivery(admin as never, claimValues);
    expect(retry.status).toBe("claimed");
  });

  it("lets an expired lease be taken over, and the old token cannot finalize", async () => {
    let clock = 1_000_000;
    const admin = makeAdmin(() => clock);
    const first = await claimInboundDelivery(admin as never, {
      ...claimValues,
      lease_seconds: 60,
    });
    if (first.status !== "claimed") throw new Error("expected claim");
    clock += 61_000;
    const takeover = await claimInboundDelivery(admin as never, claimValues);
    expect(takeover.status).toBe("claimed");
    const stale = await finalizeInboundDelivery(admin as never, {
      deliveryId: first.deliveryId,
      claimToken: first.claimToken,
      outcome: "accepted",
    });
    expect(stale).toEqual({ status: "lease_lost" });
  });

  it("distinguishes different messages on the same source", async () => {
    const admin = makeAdmin();
    const a = await claimInboundDelivery(admin as never, claimValues);
    const b = await claimInboundDelivery(admin as never, {
      ...claimValues,
      provider_message_id: "msg-2",
    });
    expect(a.status).toBe("claimed");
    expect(b.status).toBe("claimed");
  });

  it("surfaces database errors instead of silently deduping", async () => {
    const admin = {
      rpc: async () => ({ data: null, error: { code: "42501", message: "permission denied" } }),
    };
    const result = await claimInboundDelivery(admin as never, claimValues);
    expect(result).toEqual({ status: "error", message: "permission denied" });
  });
});

async function succeedFrom(
  admin: ReturnType<typeof makeAdmin>,
  claim: Awaited<ReturnType<typeof claimInboundDelivery>>,
) {
  if (claim.status !== "claimed") throw new Error("expected claim");
  return finalizeInboundDelivery(admin as never, {
    deliveryId: claim.deliveryId,
    claimToken: claim.claimToken,
    outcome: "accepted",
    importedJobEmailId: "import-1",
  });
}
