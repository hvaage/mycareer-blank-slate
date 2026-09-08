// ============================================================
// Leveranse A + C:
//   A. serverforutsetninger valideres FØR databasekontakt og forbruk
//   C. distribuert ratebegrensning i claim_rate_events
// ============================================================

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLAIM_MAX_ATTEMPTS,
  CLAIM_WINDOW_MS,
  claimRateCheck,
  hashClaimSource,
  isClaimRateStorageConfigured,
} from "@/lib/ai-integrations/claim-rate-limit.server";
import { generateSetupCode } from "@/lib/ai-integrations/setup-code";

// Enhver berøring av admin-klienten er databasekontakt og skal ikke skje
// når serveren er feilkonfigurert.
const dbTouched = vi.fn();
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    dbTouched();
    throw new Error("databasekontakt skulle ikke skjedd");
  },
}));

const CLAIM_ROUTE_PATH = join(
  process.cwd(),
  "src",
  "routes",
  "api",
  "public",
  "ai-integrations",
  "claim.ts",
);
const CLAIM_ROUTE = readFileSync(CLAIM_ROUTE_PATH, "utf8");

async function postClaim(): Promise<Response> {
  const mod = await import("@/routes/api/public/ai-integrations/claim");
  const route = mod.Route as unknown as {
    options: { server: { handlers: { POST: (ctx: { request: Request }) => Promise<Response> } } };
  };
  const request = new Request("https://karrierenmin.no/api/public/ai-integrations/claim", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.5" },
    body: JSON.stringify({ provider: "claude", setup_code: generateSetupCode() }),
  });
  return route.options.server.handlers.POST({ request });
}

describe("A. claim avviser feilkonfigurasjon før databasekontakt", () => {
  const originalToken = process.env["AI_INTEGRATION_TOKEN_SECRET"];
  const originalRate = process.env["CLAIM_RATE_HASH_SECRET"];

  beforeEach(() => {
    dbTouched.mockClear();
    process.env["AI_INTEGRATION_TOKEN_SECRET"] = "a".repeat(64);
    process.env["CLAIM_RATE_HASH_SECRET"] = "b".repeat(64);
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env["AI_INTEGRATION_TOKEN_SECRET"];
    else process.env["AI_INTEGRATION_TOKEN_SECRET"] = originalToken;
    if (originalRate === undefined) delete process.env["CLAIM_RATE_HASH_SECRET"];
    else process.env["CLAIM_RATE_HASH_SECRET"] = originalRate;
  });

  it("manglende AI_INTEGRATION_TOKEN_SECRET gir 500 uten databasekontakt", async () => {
    delete process.env["AI_INTEGRATION_TOKEN_SECRET"];
    const res = await postClaim();
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("server_misconfigured");
    expect(dbTouched).not.toHaveBeenCalled();
  });

  it("for kort AI_INTEGRATION_TOKEN_SECRET gir 500 uten databasekontakt", async () => {
    process.env["AI_INTEGRATION_TOKEN_SECRET"] = "kort";
    const res = await postClaim();
    expect(res.status).toBe(500);
    expect(dbTouched).not.toHaveBeenCalled();
  });

  it("manglende CLAIM_RATE_HASH_SECRET gir 500 uten databasekontakt", async () => {
    delete process.env["CLAIM_RATE_HASH_SECRET"];
    const res = await postClaim();
    expect(res.status).toBe(500);
    expect(dbTouched).not.toHaveBeenCalled();
  });

  it("svaret røper ikke hvilken hemmelighet som mangler", async () => {
    delete process.env["AI_INTEGRATION_TOKEN_SECRET"];
    const text = await (await postClaim()).text();
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("TOKEN");
  });

  it("konfigurasjonssjekken står før all databasebruk i ruten", () => {
    const configAt = CLAIM_ROUTE.indexOf("isTokenRuntimeConfigured()");
    const dbAt = CLAIM_ROUTE.indexOf("client.server");
    const consumeAt = CLAIM_ROUTE.indexOf("consumed_at: nowIso");
    expect(configAt).toBeGreaterThan(-1);
    expect(configAt).toBeLessThan(dbAt);
    expect(configAt).toBeLessThan(consumeAt);
  });

  it("aktivering skjer aldri i den feilkonfigurerte grenen", () => {
    const configAt = CLAIM_ROUTE.indexOf("isTokenRuntimeConfigured()");
    expect(CLAIM_ROUTE.indexOf('status: "active"')).toBeGreaterThan(configAt);
  });
});

describe("A. isTokenRuntimeConfigured er server-only", () => {
  it("ligger i en .server.ts-fil som er sperret fra klientbundelen", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "ai-integrations", "token.server.ts"),
      "utf8",
    );
    expect(src).toContain("export function isTokenRuntimeConfigured");
  });

  it("importeres ikke av klientkomponenter", () => {
    const component = readFileSync(
      join(process.cwd(), "src", "components", "ai-integrations", "ai-integration-setup.tsx"),
      "utf8",
    );
    expect(component).not.toContain("token.server");
    expect(component).not.toContain("AI_INTEGRATION_TOKEN_SECRET");
  });

  it("hentes bare via dynamisk import inne i serverhandleren", () => {
    expect(CLAIM_ROUTE).toContain('await import("@/lib/ai-integrations/token.server")');
    expect(CLAIM_ROUTE).not.toMatch(/^import .*token\.server/m);
  });
});

describe("A. last_verified_at betyr bekreftet forbindelse, ikke egenskaper", () => {
  it("er dokumentert i kontrakten", () => {
    const contract = readFileSync(
      join(process.cwd(), "src", "lib", "ai-integrations", "contract.ts"),
      "utf8",
    );
    expect(contract).toContain("LAST_VERIFIED_AT_MEANING");
    expect(contract).toContain("Sier ingenting om hvilke egenskaper som er bekreftet");
  });

  it("forklares i brukerflaten", () => {
    const component = readFileSync(
      join(process.cwd(), "src", "components", "ai-integrations", "ai-integration-setup.tsx"),
      "utf8",
    );
    expect(component).toContain("ikke at egenskapene over er sjekket");
  });

  it("claim svarer fortsatt med capabilities_verified: false", () => {
    expect(CLAIM_ROUTE).toContain("capabilities_verified: false");
    expect(CLAIM_ROUTE).toContain("last_verified_at: nowIso");
  });
});

// ---------- C. distribuert ratebegrensning ----------

type Row = { source_hash: string; occurred_at: string };

function fakeSharedStore(
  rows: Row[] = [],
  opts: { failInsert?: boolean; failCount?: boolean } = {},
) {
  return {
    rows,
    insert: async (source_hash: string, occurred_at: string) => {
      if (opts.failInsert) return { error: new Error("nede") };
      rows.push({ source_hash, occurred_at });
      return { error: null };
    },
    count: async (source_hash: string, sinceIso: string) => {
      if (opts.failCount) return { count: null, error: new Error("nede") };
      return {
        count: rows.filter((r) => r.source_hash === source_hash && r.occurred_at >= sinceIso)
          .length,
        error: null,
      };
    },
    cleanup: async () => undefined,
  };
}

describe("C. distribuert ratebegrensning", () => {
  const secret = "c".repeat(64);
  const originalRate = process.env["CLAIM_RATE_HASH_SECRET"];

  beforeEach(() => {
    process.env["CLAIM_RATE_HASH_SECRET"] = secret;
  });
  afterEach(() => {
    if (originalRate === undefined) delete process.env["CLAIM_RATE_HASH_SECRET"];
    else process.env["CLAIM_RATE_HASH_SECRET"] = originalRate;
  });

  it("slipper gjennom inntil grensen og stopper deretter", async () => {
    const store = fakeSharedStore();
    for (let i = 0; i < CLAIM_MAX_ATTEMPTS; i += 1) {
      expect((await claimRateCheck("203.0.113.5", { store })).allowed).toBe(true);
    }
    const blocked = await claimRateCheck("203.0.113.5", { store });
    expect(blocked).toEqual({ allowed: false, reason: "rate_limited" });
  });

  it("glemmer forsøk utenfor tidsvinduet", async () => {
    const store = fakeSharedStore();
    const t0 = new Date("2026-09-08T12:00:00.000Z");
    for (let i = 0; i <= CLAIM_MAX_ATTEMPTS; i += 1) {
      await claimRateCheck("203.0.113.5", { store, now: t0 });
    }
    const later = new Date(t0.getTime() + CLAIM_WINDOW_MS + 60_000);
    expect((await claimRateCheck("203.0.113.5", { store, now: later })).allowed).toBe(true);
  });

  it("holder kilder adskilt", async () => {
    const store = fakeSharedStore();
    for (let i = 0; i <= CLAIM_MAX_ATTEMPTS; i += 1) await claimRateCheck("1.2.3.4", { store });
    expect((await claimRateCheck("5.6.7.8", { store })).allowed).toBe(true);
  });

  it("teller på tvers av instanser fordi lagringen er felles", async () => {
    const rows: Row[] = [];
    const instanceA = fakeSharedStore(rows);
    const instanceB = fakeSharedStore(rows);
    for (let i = 0; i < CLAIM_MAX_ATTEMPTS; i += 1) {
      const store = i % 2 === 0 ? instanceA : instanceB;
      expect((await claimRateCheck("203.0.113.5", { store })).allowed).toBe(true);
    }
    expect((await claimRateCheck("203.0.113.5", { store: instanceB })).allowed).toBe(false);
  });

  it("feiler lukket ved databasefeil", async () => {
    expect(
      await claimRateCheck("1.2.3.4", { store: fakeSharedStore([], { failInsert: true }) }),
    ).toEqual({
      allowed: false,
      reason: "storage_error",
    });
    expect(
      await claimRateCheck("1.2.3.4", { store: fakeSharedStore([], { failCount: true }) }),
    ).toEqual({
      allowed: false,
      reason: "storage_error",
    });
  });

  it("feiler lukket når hemmeligheten mangler", async () => {
    delete process.env["CLAIM_RATE_HASH_SECRET"];
    expect(isClaimRateStorageConfigured()).toBe(false);
    expect(await claimRateCheck("1.2.3.4", { store: fakeSharedStore() })).toEqual({
      allowed: false,
      reason: "not_configured",
    });
  });

  it("lagrer kilden bare som ikke-reverserbar hash", async () => {
    const store = fakeSharedStore();
    await claimRateCheck("203.0.113.5", { store });
    const stored = store.rows[0]!;
    expect(stored.source_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.source_hash).not.toContain("203.0.113.5");
    expect(stored.source_hash).toBe(await hashClaimSource("203.0.113.5", secret));
    expect(await hashClaimSource("203.0.113.5", "d".repeat(64))).not.toBe(stored.source_hash);
    expect(Object.keys(stored).sort()).toEqual(["occurred_at", "source_hash"]);
  });
});
