import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  UNVERIFIED_CAPABILITIES,
  claimCapabilities,
  pickAllowedCapabilities,
} from "@/lib/ai-integrations/claim-contract";
import { deriveEffectiveMode } from "@/lib/ai-integrations/contract";
import { claimClientKey } from "@/lib/ai-integrations/claim-rate-limit.server";

const CLAIM_ROUTE = readFileSync(
  join(process.cwd(), "src", "routes", "api", "public", "ai-integrations", "claim.ts"),
  "utf8",
);

describe("A. capabilities kan aldri bekreftes av klienten", () => {
  it("claim gir tomme egenskaper selv når klienten påstår alt", () => {
    const claimed = {
      background_execution: true,
      scheduled_runs: true,
      email_forward_or_send: true,
    };
    // Selv et fullt gyldig, allowlistet objekt gir ingenting ved claim.
    expect(pickAllowedCapabilities(claimed)).toEqual(claimed);
    expect(claimCapabilities(claimed)).toEqual({});
    expect(UNVERIFIED_CAPABILITIES).toEqual({});
  });

  it("tomme egenskaper gir den mest konservative modusen", () => {
    expect(deriveEffectiveMode(claimCapabilities({ scheduled_runs: true }))).toBe(
      deriveEffectiveMode({}),
    );
  });

  it("claim-ruten leser ikke capabilities fra forespørselen", () => {
    expect(CLAIM_ROUTE).not.toContain("pickAllowedCapabilities");
    expect(CLAIM_ROUTE).not.toMatch(/\["capabilities"\]/);
    expect(CLAIM_ROUTE).toContain("claimCapabilities()");
  });

  it("svaret skiller aktiv forbindelse fra bekreftede egenskaper", () => {
    expect(CLAIM_ROUTE).toContain("capabilities_verified: false");
  });
});

describe("D. robusthet i claim", () => {
  it("koden forbrukes før aktivering, så en feil etterpå krever ny kode", () => {
    // Rekkefølgen i ruten er bevisst: consume først (atomisk), så aktivering.
    const consumeAt = CLAIM_ROUTE.indexOf("consumed_at");
    const activateAt = CLAIM_ROUTE.indexOf('status: "active"');
    expect(consumeAt).toBeGreaterThan(-1);
    expect(activateAt).toBeGreaterThan(consumeAt);
  });

  it("er dokumentert at en oppbrukt kode ikke kan gjenbrukes", () => {
    const contract = readFileSync(
      join(process.cwd(), "integrations", "karrierenmin-agents", "common", "CONTRACT.md"),
      "utf8",
    );
    expect(contract).toContain("Koden forbrukes før aktivering");
    expect(contract).toContain("ny kode");
    expect(contract).toContain("ikke røpe intern årsak");
  });

  it("engangskoden logges aldri i ruten", () => {
    for (const line of CLAIM_ROUTE.split("\n")) {
      if (!line.includes("console.")) continue;
      expect(line).not.toMatch(/setup_code|\bcode\b/);
    }
  });
});

describe("D. rate-limit-kilden", () => {
  const req = (headers: Record<string, string>) => new Request("https://x/", { headers });

  it("foretrekker edge-headeren som klienten ikke kan sette", () => {
    expect(
      claimClientKey(req({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1" })),
    ).toBe("203.0.113.9");
  });

  it("bruker første x-forwarded-for når edge-headeren mangler", () => {
    expect(claimClientKey(req({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" }))).toBe(
      "198.51.100.7",
    );
  });

  it("faller tilbake til unknown uten kjent kilde", () => {
    expect(claimClientKey(req({}))).toBe("unknown");
  });

  it("dokumenterer at x-forwarded-for bare er trygg bak en overskrivende edge", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "ai-integrations", "claim-rate-limit.server.ts"),
      "utf8",
    );
    expect(src).toContain("overskriver");
    expect(src).toContain("FAIL CLOSED");
  });
});

describe("B. ingen påstand om installerbar MCP", () => {
  it("testplanen sperrer live-E2E til ekte transport finnes", () => {
    const plan = readFileSync(
      join(process.cwd(), "docs", "operations", "ai-integrations-e2e-test-plan.md"),
      "utf8",
    );
    expect(plan).toContain("kan ikke markeres bestått");
    expect(plan).toContain("MCP");
    expect(plan).toContain("ai-integrations-mcp-oauth-spec.md");
  });
});
