import { describe, expect, it, beforeEach } from "vitest";
import {
  CAPABILITY_ALLOWLIST,
  CLAIM_REJECTION,
  isAgentUsableStatus,
  isAgentWorkflowKind,
  normalizeSetupCode,
  parseClaimInput,
  pickAllowedCapabilities,
} from "@/lib/ai-integrations/claim-contract";
import { deriveEffectiveMode, AI_PROVIDERS } from "@/lib/ai-integrations/contract";
import { generateSetupCode, sha256Hex } from "@/lib/ai-integrations/setup-code";
import { isSetupCodeExpired, setupCodeExpiry } from "@/lib/ai-integrations/contract";
import {
  claimRateLimited,
  resetClaimRateLimit,
  CLAIM_MAX_ATTEMPTS,
} from "@/lib/ai-integrations/claim-rate-limit.server";

describe("normalisering av engangskode", () => {
  it("fjerner bindestreker og mellomrom og gjør om til versaler", () => {
    const raw = generateSetupCode();
    const messy = ` ${raw
      .toLowerCase()
      .match(/.{1,4}/g)!
      .join("-")} `;
    expect(normalizeSetupCode(messy)).toBe(raw);
  });

  it("godtar både formatert og uformatert kode", () => {
    const raw = generateSetupCode();
    const formatted = raw.match(/.{1,4}/g)!.join("-");
    for (const provider of AI_PROVIDERS) {
      const a = parseClaimInput({ provider, setup_code: raw });
      const b = parseClaimInput({ provider, setup_code: formatted.toLowerCase() });
      expect(a.ok && b.ok).toBe(true);
      if (a.ok && b.ok) expect(a.value.code).toBe(b.value.code);
    }
  });

  it("avviser feil format før databasekontakt", () => {
    expect(parseClaimInput({ provider: "claude", setup_code: "ABC" }).ok).toBe(false);
    expect(parseClaimInput({ provider: "claude", setup_code: "0".repeat(32) }).ok).toBe(false);
    expect(parseClaimInput({ provider: "claude", setup_code: "x".repeat(500) }).ok).toBe(false);
    expect(parseClaimInput({ provider: "llama", setup_code: generateSetupCode() }).ok).toBe(false);
    expect(parseClaimInput(null).ok).toBe(false);
    expect(parseClaimInput([]).ok).toBe(false);
  });

  it("ignorerer user_id og integration_id fra forespørselen", () => {
    const result = parseClaimInput({
      provider: "openai",
      setup_code: generateSetupCode(),
      user_id: "00000000-0000-0000-0000-000000000001",
      integration_id: "00000000-0000-0000-0000-000000000002",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value).sort()).toEqual(["code", "provider"]);
    expect(JSON.stringify(result.value)).not.toContain("0000000000");
  });
});

describe("hash og utløp", () => {
  it("hasher normalisert kode til 64 heks-tegn", async () => {
    const raw = generateSetupCode();
    const formatted = raw
      .match(/.{1,4}/g)!
      .join("-")
      .toLowerCase();
    const a = await sha256Hex(normalizeSetupCode(formatted));
    const b = await sha256Hex(raw);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain(raw);
  });

  it("regner utløpt kode som ubrukelig", () => {
    const now = new Date("2026-09-08T12:00:00.000Z");
    const exp = setupCodeExpiry(now);
    expect(isSetupCodeExpired(exp, new Date("2026-09-08T12:14:00.000Z"))).toBe(false);
    expect(isSetupCodeExpired(exp, new Date("2026-09-08T12:16:00.000Z"))).toBe(true);
  });
});

describe("capability-allowlist", () => {
  it("beholder bare de tre tillatte egenskapene", () => {
    const picked = pickAllowedCapabilities({
      background_execution: true,
      scheduled_runs: false,
      email_forward_or_send: true,
      is_admin: true,
      plan_tier: "paid",
      nested: { background_execution: true },
    });
    expect(Object.keys(picked).sort()).toEqual([...CAPABILITY_ALLOWLIST].sort());
    expect(picked).toEqual({
      background_execution: true,
      scheduled_runs: false,
      email_forward_or_send: true,
    });
  });

  it("forkaster ikke-boolske verdier og ugyldig input", () => {
    expect(pickAllowedCapabilities({ background_execution: "yes" })).toEqual({});
    expect(pickAllowedCapabilities(null)).toEqual({});
    expect(pickAllowedCapabilities(["background_execution"])).toEqual({});
  });

  it("utleder effective_mode server-side fra allowlistede egenskaper", () => {
    const claimed = pickAllowedCapabilities({
      background_execution: true,
      scheduled_runs: true,
      email_forward_or_send: true,
      effective_mode: "hybrid",
      plan_tier: "paid",
    });
    expect(deriveEffectiveMode(claimed)).toBe("hybrid");
    expect(deriveEffectiveMode(pickAllowedCapabilities({ plan_tier: "paid" }))).toBe("guided");
  });
});

describe("agenttilgang og arbeidsflyter", () => {
  it("tillater bare active og degraded", () => {
    expect(isAgentUsableStatus("active")).toBe(true);
    expect(isAgentUsableStatus("degraded")).toBe(true);
    for (const status of ["draft", "connecting", "disconnected", null, undefined]) {
      expect(isAgentUsableStatus(status as string | null)).toBe(false);
    }
  });

  it("tillater bare allowlistede arbeidsflyter", () => {
    expect(isAgentWorkflowKind("job_import")).toBe(true);
    expect(isAgentWorkflowKind("career_log")).toBe(true);
    expect(isAgentWorkflowKind("linkedin_ready")).toBe(true);
    expect(isAgentWorkflowKind("cleanup")).toBe(false);
    expect(isAgentWorkflowKind("drop_table")).toBe(false);
  });
});

describe("avvisning uten informasjonslekkasje", () => {
  it("bruker én generisk melding", () => {
    expect(CLAIM_REJECTION.code).toBe("invalid_claim");
    const text = JSON.stringify(CLAIM_REJECTION).toLowerCase();
    for (const leak of ["utløp", "brukt", "finnes ikke", "feil leverandør", "frakoblet"]) {
      expect(text).not.toContain(leak);
    }
  });
});

describe("grunnrate for claim", () => {
  beforeEach(() => resetClaimRateLimit());

  it("slipper gjennom inntil grensen og stopper deretter", () => {
    for (let i = 0; i < CLAIM_MAX_ATTEMPTS; i++) {
      expect(claimRateLimited("1.2.3.4")).toBe(false);
    }
    expect(claimRateLimited("1.2.3.4")).toBe(true);
  });

  it("holder kilder adskilt og glemmer gamle forsøk", () => {
    const t0 = Date.now();
    for (let i = 0; i < CLAIM_MAX_ATTEMPTS + 1; i++) claimRateLimited("1.2.3.4", t0);
    expect(claimRateLimited("5.6.7.8", t0)).toBe(false);
    expect(claimRateLimited("1.2.3.4", t0 + 11 * 60_000)).toBe(false);
  });
});
