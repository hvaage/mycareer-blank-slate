import { describe, expect, it } from "vitest";
import { generateSetupCode, sha256Hex } from "@/lib/ai-integrations/setup-code";
import { isValidSetupCodeFormat, SETUP_CODE_LENGTH } from "@/lib/ai-integrations/contract";

describe("generateSetupCode", () => {
  it("lager koder med riktig lengde og alfabet", () => {
    for (let i = 0; i < 25; i++) {
      const code = generateSetupCode();
      expect(code).toHaveLength(SETUP_CODE_LENGTH);
      expect(isValidSetupCodeFormat(code)).toBe(true);
    }
  });

  it("gjentar seg ikke", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateSetupCode()));
    expect(codes.size).toBe(200);
  });
});

describe("sha256Hex", () => {
  it("gir 64 heksadesimale tegn slik databasen krever", async () => {
    const hash = await sha256Hex(generateSetupCode());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("lagrer aldri koden i klartekst", async () => {
    const code = generateSetupCode();
    const hash = await sha256Hex(code);
    expect(hash).not.toContain(code);
    expect(hash.toUpperCase()).not.toContain(code);
  });

  it("er stabil for samme kode", async () => {
    expect(await sha256Hex("ABCD")).toBe(await sha256Hex("ABCD"));
    expect(await sha256Hex("ABCD")).not.toBe(await sha256Hex("ABCE"));
  });
});
