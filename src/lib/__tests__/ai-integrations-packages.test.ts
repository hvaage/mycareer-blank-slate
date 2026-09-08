import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AI_PROVIDERS } from "@/lib/ai-integrations/contract";
import { parseClaimInput, pickAllowedCapabilities } from "@/lib/ai-integrations/claim-contract";
import { generateSetupCode } from "@/lib/ai-integrations/setup-code";

const ROOT = join(process.cwd(), "integrations", "karrierenmin-agents");
const PACKAGE_DIR: Record<string, string> = {
  grok: "grok",
  claude: "claude",
  openai: "openai",
  gemini: "gemini",
};

function readAll(dir: string): string {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => readFileSync(join(dir, e.name), "utf8"))
    .join("\n");
}

describe("fire likestilte installasjonspakker", () => {
  it("har felles kontrakt og sikkerhetsregler", () => {
    for (const file of ["CONTRACT.md", "SECURITY.md", "tools.json", "config.example.json"]) {
      expect(existsSync(join(ROOT, "common", file))).toBe(true);
    }
  });

  for (const provider of AI_PROVIDERS) {
    describe(provider, () => {
      const dir = join(ROOT, PACKAGE_DIR[provider]!);

      it("finnes med README", () => {
        expect(existsSync(join(dir, "README.md"))).toBe(true);
      });

      it("bruker samme claim- og statussemantikk", () => {
        const text = readAll(dir);
        expect(text).toContain("karrierenmin_claim");
        expect(text).toContain("karrierenmin_status");
        expect(text).toContain("/api/public/ai-integrations/claim");
        expect(text).toContain("/api/public/ai-integrations/v1/status");
      });

      it("peker på offentlig HTTPS-placeholder, ikke localhost", () => {
        const text = readAll(dir);
        expect(text).toContain("https://REPLACE-WITH-YOUR-PUBLIC-HOST");
        expect(text.toLowerCase()).not.toContain("localhost");
        expect(text).not.toContain("127.0.0.1");
      });

      it("forbyr token i prompt, logg og URL, og forbyr LinkedIn-automatikk", () => {
        const text = readAll(dir).toLowerCase();
        expect(text).toContain("logg");
        expect(text).toContain("aldri");
        expect(text).toContain("linkedin");
        expect(text).not.toMatch(/token=/);
        expect(text).not.toMatch(/\?.*integration_token/);
      });

      it("krever faktiske capabilities, ikke abonnementspåstand", () => {
        const text = readAll(dir).toLowerCase();
        expect(text).toContain("abonnement");
        expect(text).toContain("faktisk");
      });

      it("oppgir ingen oppdiktet marketplace-ID eller katalogslenke", () => {
        const text = readAll(dir).toLowerCase();
        for (const invented of ["marketplace_id", "store.", "plugin_id", "listing_id"]) {
          expect(text).not.toContain(invented);
        }
      });

      it("kjører samme claim-testvektor", () => {
        const code = generateSetupCode();
        const formatted = code
          .match(/.{1,4}/g)!
          .join("-")
          .toLowerCase();
        const parsed = parseClaimInput({ provider, setup_code: formatted });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.value.provider).toBe(provider);
        expect(parsed.value.code).toBe(code);

        // Feil kodeformat avvises likt for alle fire.
        expect(parseClaimInput({ provider, setup_code: "0000" }).ok).toBe(false);
        // Påstått abonnement gir aldri capabilities.
        expect(pickAllowedCapabilities({ plan_tier: "paid", pro: true })).toEqual({});
      });
    });
  }

  it("merker tydelig hva som er kildepakke og hva som krever marketplace-innsending", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    expect(readme).toContain("Kildepakke");
    expect(readme).toContain("Manuelt installérbart");
    expect(readme).toContain("marketplace-innsending");
  });
});

describe("ingen hemmeligheter i repoet", () => {
  it("pakkene inneholder ingen reelle token- eller nøkkelverdier", () => {
    const all = [
      ROOT,
      join(ROOT, "common"),
      ...Object.values(PACKAGE_DIR).map((d) => join(ROOT, d)),
    ]
      .map(readAll)
      .join("\n");
    expect(all).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(all).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\./);
    expect(all).not.toMatch(/sb_(secret|publishable)_/);
  });
});
