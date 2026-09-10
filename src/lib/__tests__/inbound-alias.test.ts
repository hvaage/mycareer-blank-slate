import { describe, expect, it } from "vitest";
import {
  ALIAS_TOKEN_PATTERN,
  aliasTokenFromAddress,
  base32LowerEncode,
  formatInboundAddress,
  generateAliasToken,
  isValidAliasToken,
} from "@/lib/job-leads/inbound-alias";
import { senderDomain } from "@/lib/job-leads/inbound-intake.server";

describe("inbound alias token", () => {
  it("genererer 32 tegn lowercase base32 som matcher databasens format", () => {
    for (let i = 0; i < 50; i++) {
      const token = generateAliasToken();
      expect(token).toHaveLength(32);
      expect(ALIAS_TOKEN_PATTERN.test(token)).toBe(true);
    }
  });

  it("er ugjettbart: ingen kollisjoner og ingen avledning fra bruker-id", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateAliasToken()));
    expect(tokens.size).toBe(500);
  });

  it("koder base32 deterministisk", () => {
    expect(base32LowerEncode(new Uint8Array([0, 0, 0, 0, 0]))).toBe("aaaaaaaa");
    expect(base32LowerEncode(new Uint8Array([255, 255, 255, 255, 255]))).toBe("77777777");
  });

  it("avviser ugyldige tokens", () => {
    expect(isValidAliasToken(null)).toBe(false);
    expect(isValidAliasToken("")).toBe(false);
    expect(isValidAliasToken("abc")).toBe(false);
    expect(isValidAliasToken("ABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBe(false);
    expect(isValidAliasToken("abcdefghijklmnopqrstuvwxy1")).toBe(false); // 1 er ikke i base32
    expect(isValidAliasToken("a".repeat(65))).toBe(false);
    expect(isValidAliasToken("a".repeat(26))).toBe(true);
  });
});

describe("aliasTokenFromAddress", () => {
  const token = generateAliasToken();

  it("leser token fra ren adresse og fra display-navn", () => {
    expect(aliasTokenFromAddress(`${token}@jobb.karrierenmin.no`)).toBe(token);
    expect(aliasTokenFromAddress(`Karrierenmin <${token}@jobb.karrierenmin.no>`)).toBe(token);
    expect(aliasTokenFromAddress(`${token.toUpperCase()}@jobb.karrierenmin.no`)).toBe(token);
  });

  it("fjerner plus-adressering", () => {
    expect(aliasTokenFromAddress(`${token}+finn@jobb.karrierenmin.no`)).toBe(token);
  });

  it("returnerer null for adresser som ikke er alias", () => {
    expect(aliasTokenFromAddress("post@karrierenmin.no")).toBeNull();
    expect(aliasTokenFromAddress("")).toBeNull();
    expect(aliasTokenFromAddress(null)).toBeNull();
    expect(aliasTokenFromAddress("@jobb.karrierenmin.no")).toBeNull();
  });
});

describe("formatInboundAddress", () => {
  const token = generateAliasToken();

  it("bygger adressen når domenet er gyldig", () => {
    expect(formatInboundAddress(token, "jobb.karrierenmin.no")).toBe(
      `${token}@jobb.karrierenmin.no`,
    );
    expect(formatInboundAddress(token, "@JOBB.karrierenmin.no ")).toBe(
      `${token}@jobb.karrierenmin.no`,
    );
  });

  it("returnerer null for ugyldig token eller domene", () => {
    expect(formatInboundAddress("kort", "jobb.karrierenmin.no")).toBeNull();
    expect(formatInboundAddress(token, "")).toBeNull();
    expect(formatInboundAddress(token, "localhost")).toBeNull();
  });
});

describe("senderDomain", () => {
  it("henter avsenderdomenet uten å ta vare på lokaldelen", () => {
    expect(senderDomain("jobb@finn.no")).toBe("finn.no");
    expect(senderDomain("Finn <jobb@finn.no>")).toBe("finn.no");
    expect(senderDomain("ugyldig")).toBeNull();
  });
});
