import { describe, expect, it } from "vitest";
import {
  AI_PROVIDERS,
  DEFAULT_AUTOMATION_CHOICES,
  deriveEffectiveMode,
  formatSetupCode,
  isSetupCodeExpired,
  isValidSetupCodeFormat,
  parseSaveIntegrationInput,
  SETUP_CODE_ALPHABET,
  SETUP_CODE_LENGTH,
  setupCodeExpiry,
} from "@/lib/ai-integrations/contract";

describe("deriveEffectiveMode", () => {
  it("gir hybrid for bakgrunn + planlagt + e-post", () => {
    expect(
      deriveEffectiveMode({
        background_execution: true,
        scheduled_runs: true,
        email_forward_or_send: true,
      }),
    ).toBe("hybrid");
  });

  it("gir agent for bakgrunn + planlagt", () => {
    expect(deriveEffectiveMode({ background_execution: true, scheduled_runs: true })).toBe("agent");
  });

  it("gir email_rule for kun e-post", () => {
    expect(deriveEffectiveMode({ email_forward_or_send: true })).toBe("email_rule");
  });

  it("gir guided ellers", () => {
    expect(deriveEffectiveMode({})).toBe("guided");
    expect(deriveEffectiveMode(null)).toBe("guided");
    expect(deriveEffectiveMode({ background_execution: true })).toBe("guided");
    expect(deriveEffectiveMode({ scheduled_runs: true, email_forward_or_send: true })).toBe("guided");
  });

  it("stoler ikke på oppgitt abonnement — kun bekreftede egenskaper", () => {
    expect(deriveEffectiveMode({ background_execution: false, scheduled_runs: false })).toBe("guided");
  });
});

describe("parseSaveIntegrationInput", () => {
  it("godtar alle fire leverandører likt", () => {
    for (const provider of AI_PROVIDERS) {
      const result = parseSaveIntegrationInput({ provider, plan_tier: "free" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.provider).toBe(provider);
    }
  });

  it("avviser ukjent leverandør og ukjent abonnement", () => {
    expect(parseSaveIntegrationInput({ provider: "llama" }).ok).toBe(false);
    expect(parseSaveIntegrationInput({ provider: "claude", plan_tier: "premium" }).ok).toBe(false);
    expect(parseSaveIntegrationInput(null).ok).toBe(false);
    expect(parseSaveIntegrationInput([]).ok).toBe(false);
  });

  it("bruker produktkravets standardvalg", () => {
    const result = parseSaveIntegrationInput({ provider: "gemini" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plan_tier).toBe("unknown");
    expect(result.value.automation).toEqual(DEFAULT_AUTOMATION_CHOICES);
  });

  it("slår av LinkedIn-varsling når LinkedIn-import er valgt bort", () => {
    const result = parseSaveIntegrationInput({
      provider: "grok",
      plan_tier: "paid",
      automation: { linkedin_export_import_enabled: false, linkedin_ready_detection_enabled: true },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.automation.linkedin_export_import_enabled).toBe(false);
    expect(result.value.automation.linkedin_ready_detection_enabled).toBe(false);
  });

  it("ignorerer user_id og andre felt fra forespørselen", () => {
    const result = parseSaveIntegrationInput({
      provider: "openai",
      plan_tier: "free",
      user_id: "00000000-0000-0000-0000-000000000001",
      status: "active",
      effective_mode: "hybrid",
      capabilities: { background_execution: true },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value).sort()).toEqual(["automation", "plan_tier", "provider"]);
    expect(JSON.stringify(result.value)).not.toContain("00000000-0000-0000-0000-000000000001");
  });
});

describe("engangskode", () => {
  it("har riktig format og alfabet", () => {
    const raw = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    expect(raw.length).toBe(SETUP_CODE_LENGTH);
    const formatted = formatSetupCode(raw);
    expect(formatted.split("-").length).toBe(8);
    expect(isValidSetupCodeFormat(formatted)).toBe(true);
    expect(isValidSetupCodeFormat("ABC")).toBe(false);
    expect(isValidSetupCodeFormat(raw.replace("A", "0"))).toBe(false);
  });

  it("bruker et forvekslingsfritt alfabet", () => {
    for (const ch of ["0", "1", "I", "O"]) {
      expect(SETUP_CODE_ALPHABET).not.toContain(ch);
    }
  });

  it("utløper etter 15 minutter", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");
    const exp = setupCodeExpiry(now);
    expect(exp.toISOString()).toBe("2026-01-01T12:15:00.000Z");
    expect(isSetupCodeExpired(exp, new Date("2026-01-01T12:14:59.000Z"))).toBe(false);
    expect(isSetupCodeExpired(exp, new Date("2026-01-01T12:15:01.000Z"))).toBe(true);
  });
});
