import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateInboundAliasToken } from "@/lib/job-leads/ingest";
import {
  DEFAULT_GROK_TEMPLATE_URL,
  deriveGrokBotUiState,
  deriveGrokSetupStatus,
  formatInboundAlias,
  generateGrokSetupCode,
  GROK_SETUP_CODE_ALPHABET,
  GROK_SETUP_CODE_LENGTH,
  GROK_SETUP_TTL_MS,
  inboundMatchesAlias,
  INBOUND_JOB_DOMAIN,
  isSetupSessionOpen,
  resolveGrokTemplateUrl,
} from "@/lib/job-leads/grok-bot";

describe("Grok Bot alias og oppsettkode", () => {
  it("bygger jobb-adressen på jobb.karrierenmin.no", () => {
    expect(INBOUND_JOB_DOMAIN).toBe("jobb.karrierenmin.no");
    expect(formatInboundAlias("AbC123")).toBe("abc123@jobb.karrierenmin.no");
  });

  it("gjenkjenner mottaker mot gjeldende token, ikke gammelt alias", () => {
    const token = "abcde234";
    expect(inboundMatchesAlias("abcde234@jobb.karrierenmin.no", token)).toBe(true);
    expect(inboundMatchesAlias("Name <abcde234@jobb.karrierenmin.no>", token)).toBe(true);
    expect(inboundMatchesAlias("oldtoken@jobb.karrierenmin.no", token)).toBe(false);
  });

  it("lager 8-tegns oppsettkode uten tvetydige tegn", () => {
    const code = generateGrokSetupCode(() => Uint8Array.from([0, 1, 31, 32, 200, 255, 7, 9]));
    expect(code).toHaveLength(GROK_SETUP_CODE_LENGTH);
    expect([...code].every((ch) => GROK_SETUP_CODE_ALPHABET.includes(ch))).toBe(true);
    expect(code).not.toMatch(/[01oil]/i);
  });

  it("markerer oppsettkode som utløpt etter TTL", () => {
    const now = new Date("2026-09-04T12:00:00.000Z");
    const open = isSetupSessionOpen(
      { expires_at: "2026-09-04T12:44:00.000Z", consumed_at: null },
      now,
    );
    const expired = isSetupSessionOpen(
      { expires_at: "2026-09-04T11:59:00.000Z", consumed_at: null },
      now,
    );
    const consumed = isSetupSessionOpen(
      { expires_at: "2026-09-04T12:44:00.000Z", consumed_at: "2026-09-04T11:30:00.000Z" },
      now,
    );
    expect(open).toBe(true);
    expect(expired).toBe(false);
    expect(consumed).toBe(false);
    expect(GROK_SETUP_TTL_MS).toBeGreaterThanOrEqual(30 * 60 * 1000);
    expect(GROK_SETUP_TTL_MS).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it("mapper status til UI-tilstand A/B/C", () => {
    expect(
      deriveGrokBotUiState({
        status: "pending_alias",
        is_active: false,
        has_open_setup_session: false,
      }),
    ).toBe("inactive");
    expect(
      deriveGrokBotUiState({
        status: "pending_verify",
        is_active: true,
        has_open_setup_session: true,
      }),
    ).toBe("pending_verify");
    expect(
      deriveGrokBotUiState({
        status: "active",
        is_active: true,
        has_open_setup_session: false,
      }),
    ).toBe("active");
  });

  it("holder aktiv status bare når aliaset er slått på", () => {
    expect(
      deriveGrokSetupStatus({ hasAlias: true, verifiedAt: "2026-09-04T12:00:00Z", isActive: true }),
    ).toBe("active");
    expect(
      deriveGrokSetupStatus({ hasAlias: true, verifiedAt: "2026-09-04T12:00:00Z", isActive: false }),
    ).toBe("pending_verify");
    expect(deriveGrokSetupStatus({ hasAlias: false, verifiedAt: null, isActive: false })).toBe(
      "pending_alias",
    );
  });

  it("bruker GROK_TEMPLATE_URL når den er satt, ellers offentlig fallback", () => {
    expect(resolveGrokTemplateUrl(" https://grok.com/t/example ")).toBe(
      "https://grok.com/t/example",
    );
    expect(resolveGrokTemplateUrl("")).toBe(DEFAULT_GROK_TEMPLATE_URL);
    expect(resolveGrokTemplateUrl(undefined)).toBe(DEFAULT_GROK_TEMPLATE_URL);
  });

  it("gjenbruker generateInboundAliasToken uten å avlede av bruker-id", () => {
    const a = generateInboundAliasToken();
    const b = generateInboundAliasToken();
    expect(a).toMatch(/^[a-z2-7]+$/);
    expect(a.length).toBeGreaterThan(20);
    expect(a).not.toBe(b);
  });
});

describe("Grok Bot kontrakt mot eksisterende inntak", () => {
  const webhook = readFileSync("src/routes/api/public/inbound/job-email.ts", "utf8");
  const functions = readFileSync("src/lib/job-leads/grok-bot.functions.ts", "utf8");
  const panel = readFileSync("src/components/settings/grok-bot-panel.tsx", "utf8");
  const helpers = readFileSync("src/lib/job-leads/grok-bot.ts", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260904184500_grok_bot_jobbimport.sql",
    "utf8",
  );

  it("beholder unknown_alias 404 og ingestParsedEmail på eksisterende webhook", () => {
    expect(webhook).toContain('return finalize("unknown_alias", 404, { error: "unknown_alias" })');
    expect(webhook).toContain("ingestParsedEmail");
    expect(webhook).toContain('eq("inbound_alias_token", aliasToken)');
    expect(webhook).toContain('process.env["LOVABLE_API_KEY"]');
    expect(webhook).toContain('process.env["MAILGUN_WEBHOOK_SIGNING_KEY"]');
  });

  it("oppretter ingen ny offentlig JSON-ingest for Grok", () => {
    expect(functions).not.toMatch(/\/api\/public\/inbound\/grok/);
    expect(functions).toContain("POST /api/public/inbound/job-email");
    expect(functions).toContain("requireSupabaseAuth");
    expect(functions).toContain("generateInboundAliasToken");
  });

  it("leser GROK_TEMPLATE_URL kun server-side uten VITE_-prefiks", () => {
    expect(functions).toContain('process.env["GROK_TEMPLATE_URL"]');
    expect(functions).not.toContain("import.meta.env");
    expect(panel).not.toMatch(/LOVABLE_API_KEY|MAILGUN_WEBHOOK|SERVICE_ROLE/);
    expect(helpers).not.toMatch(/LOVABLE_API_KEY|MAILGUN_WEBHOOK|SERVICE_ROLE/);
    expect(panel).not.toContain("VITE_GROK");
  });

  it("setter RLS på grok_bot_setup_sessions uten anon-grant", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.grok_bot_setup_sessions");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON public.grok_bot_setup_sessions TO authenticated");
    expect(migration).not.toMatch(/GRANT .+ grok_bot_setup_sessions TO anon/);
    expect(migration).toContain("auth.uid() = user_id");
    expect(migration).toContain("grok_setup_status");
    expect(migration).toContain("verified_at");
  });
});
