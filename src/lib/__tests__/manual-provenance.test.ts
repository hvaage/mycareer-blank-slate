import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Kanonisk provenance for manuelt opprettede roller og resultater:
 * source_type = 'user_input'. "bruker_manuelt" er kun metadata/visningstekst.
 */
const src = readFileSync("src/lib/queries/cv-review-progress.ts", "utf8");

describe("manuell provenance i CV-gjennomgangen", () => {
  it("bruker kanonisk source_type='user_input' for både rolle og resultat", () => {
    const matches = src.match(/source_type: "user_input"/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it("skriver ikke andre kildetyper for manuelle atomer", () => {
    expect(src).not.toMatch(/source_type: "bruker"/);
    expect(src).not.toMatch(/source_type: "bruker_manuelt"/);
  });

  it("setter aldri claim-evidensstatusen user_attested fra atomflyten", () => {
    expect(src).not.toMatch(/user_attested/);
    expect(src).not.toMatch(/cv_claim_attestations/);
  });

  it("bruker atom-tillit (confidence/user_confirmed) for begge manuelle flyter", () => {
    expect((src.match(/confidence: "verified"/g) ?? []).length).toBe(2);
    expect((src.match(/user_confirmed: true/g) ?? []).length).toBe(2);
  });
});
