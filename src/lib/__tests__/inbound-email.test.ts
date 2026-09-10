import { describe, expect, it } from "vitest";
import {
  CLAIM_OUTCOME,
  aliasTokenForRecipient,
  claimInboundDelivery,
  fromDomain,
  readInboundConfig,
} from "@/lib/job-leads/inbound-email.server";

/** Mirrors inbound_email_deliveries_outcome_check in the database. */
const DB_ALLOWED_OUTCOMES = ["accepted", "duplicate", "parse_failed", "ingest_failed"];

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

/** In-memory stand-in for the unique index on the deliveries table. */
function makeAdmin() {
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  let nextId = 0;
  return {
    inserted: seen,
    rows,
    from() {
      return {
        insert(values: Record<string, unknown>) {
          rows.push(values);
          const key = `${values.email_job_source_id}|${values.provider}|${values.provider_message_id}`;
          return {
            select() {
              return {
                async maybeSingle() {
                  // Yield so concurrent callers interleave before the check.
                  await Promise.resolve();
                  if (seen.has(key)) {
                    return {
                      data: null,
                      error: { code: "23505", message: "duplicate key value" },
                    };
                  }
                  seen.add(key);
                  nextId += 1;
                  return { data: { id: `delivery-${nextId}` }, error: null };
                },
              };
            },
          };
        },
      };
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

describe("claimInboundDelivery", () => {
  it("claims once and reports replays as duplicates", async () => {
    const admin = makeAdmin();
    const first = await claimInboundDelivery(admin as never, claimValues);
    const replay = await claimInboundDelivery(admin as never, claimValues);
    expect(first.status).toBe("claimed");
    expect(replay.status).toBe("duplicate");
  });

  /** The DB CHECK only allows accepted | duplicate | parse_failed | ingest_failed. */
  it("reserves with an outcome the database CHECK allows", async () => {
    const admin = makeAdmin();
    await claimInboundDelivery(admin as never, claimValues);
    expect(CLAIM_OUTCOME).toBe("accepted");
    expect(admin.rows).toHaveLength(1);
    expect(admin.rows[0].outcome).toBe("accepted");
    expect(DB_ALLOWED_OUTCOMES).toContain(admin.rows[0].outcome as string);
    expect(admin.rows[0].provider).toBe("mailgun");
  });

  it("lets exactly one of many concurrent webhooks proceed to ingest", async () => {
    const admin = makeAdmin();
    let ingestCount = 0;

    const results = await Promise.all(
      Array.from({ length: 25 }, async () => {
        const claim = await claimInboundDelivery(admin as never, claimValues);
        if (claim.status === "claimed") ingestCount += 1;
        return claim.status;
      }),
    );

    expect(results.filter((s) => s === "claimed")).toHaveLength(1);
    expect(results.filter((s) => s === "duplicate")).toHaveLength(24);
    expect(ingestCount).toBe(1);
    expect(admin.inserted.size).toBe(1);
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

  it("surfaces non-uniqueness errors instead of silently deduping", async () => {
    const admin = {
      from: () => ({
        insert: () => ({
          select: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { code: "42501", message: "permission denied" },
            }),
          }),
        }),
      }),
    };
    const result = await claimInboundDelivery(admin as never, claimValues);
    expect(result).toEqual({ status: "error", message: "permission denied" });
  });
});
