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
  copilot: "copilot",
};

function readAll(dir: string): string {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => readFileSync(join(dir, e.name), "utf8"))
    .join("\n");
}

describe("fem likestilte pakker mot én leverandørnøytral MCP-server", () => {
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

      it("påstår aldri en verifisert installasjon hos leverandøren", () => {
        const readme = readFileSync(join(dir, "README.md"), "utf8")
          .toLowerCase()
          .replace(/\s+/g, " ");
        expect(readme).toContain("ikke verifisert ende-til-ende");
        expect(readme).not.toContain("verifisert installasjon");
      });

      it("peker på det ene leverandørnøytrale MCP-endepunktet i README", () => {
        const readme = readFileSync(join(dir, "README.md"), "utf8");
        expect(readme).toContain("https://REPLACE-WITH-YOUR-PUBLIC-HOST/api/public/mcp");
        expect(readme).toContain("## Installasjon hos denne leverandøren");
      });

      it("har ingen generisk mcp.config.json", () => {
        // Filformatet er ikke gyldig for alle fem klientene, og skal ikke
        // ligge der som om det var det.
        expect(existsSync(join(dir, "mcp.config.json"))).toBe(false);
      });

      it("legger ingen statisk nøkkel i pakken", () => {
        const body = readAll(dir);
        expect(body).not.toContain("KARRIERENMIN_INTEGRATION_TOKEN=");
        expect(body).toContain("OAuth 2.1");
      });


      it("påstår ikke automatisk lagring av tokenet", () => {
        const text = readAll(dir).toLowerCase();
        expect(text).toMatch(/lagres ikke automatisk|kopiere det inn|kopiere det|manuelt/);
      });

      it("ber ikke agenten sende capabilities i claim", () => {
        const text = readAll(dir);
        expect(text).not.toContain('"capabilities": {');
        expect(text.toLowerCase()).toMatch(/ignorer|sendes ikke|send ikke/);
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

  it("skiller nivåene og er ærlig om hva som ikke er verifisert", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    expect(readme).toContain("Kildepakke");
    expect(readme).toContain("marketplace-innsending");
    expect(readme).toContain("Streamable HTTP JSON-RPC");
    // Live installasjon er fortsatt ikke kjørt, og må stå slik.
    expect(readme).toContain("**Ikke kjørt**");
    expect(readme).toContain("ikke verifisert");
  });

  it("alle fem pakkene beskriver identiske verktøy og scopes", () => {
    const tools = JSON.parse(readFileSync(join(ROOT, "common", "tools.json"), "utf8")) as {
      tools: Array<{ name: string; scope: string }>;
    };
    expect(tools.tools.map((t) => t.name)).toEqual(["karrierenmin_status", "karrierenmin_run"]);
    for (const provider of AI_PROVIDERS) {
      const readme = readFileSync(join(ROOT, PACKAGE_DIR[provider]!, "README.md"), "utf8");
      for (const tool of tools.tools) {
        expect(readme).toContain(tool.name);
        expect(readme).toContain(tool.scope);
      }
    }
  });

  it("viser til MCP/OAuth-spesifikasjonen som gjenstående arbeid", () => {
    const spec = join(process.cwd(), "docs", "operations", "ai-integrations-mcp-oauth-spec.md");
    expect(existsSync(spec)).toBe(true);
    const text = readFileSync(spec, "utf8");
    for (const needed of [
      "tools/list",
      "tools/call",
      "initialize",
      "oauth-authorization-server",
      "code_challenge",
      "refresh_token",
      "revoke",
      "register",
    ]) {
      expect(text).toContain(needed);
    }
    // OAuth-laget og MCP-transporten er bygget; live installasjon er ikke verifisert.
    expect(text).toContain("MCP-transporten er bygget");
    expect(text).toContain("ikke verifisert ende-til-ende");
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
