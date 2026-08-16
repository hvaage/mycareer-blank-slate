// Regresjonstester for tallnormalisering i hallusinasjonsvakten.
//
// Formålet er å låse to ting samtidig:
//   1. Samme tall uttrykt på norsk og engelsk skal matche.
//   2. Ulike tall skal ALDRI matche — normaliseringen må ikke bli så slapp
//      at den godtar feil størrelsesorden.
//   3. Tallet må finnes i claimens egne supporting atoms, ikke bare et
//      annet sted i snapshotet.

import { describe, expect, it } from "vitest";
import { extractNumberClaims } from "../../../supabase/functions/_shared/cv-skills/vendor/cv-hallucination-guard/scripts/extractors/number-extractor.ts";
import { matchHardClaims } from "../../../supabase/functions/_shared/cv-skills/vendor/cv-hallucination-guard/scripts/matchers/exact-matcher.ts";
import type { AtomLike } from "../../../supabase/functions/_shared/cv-skills/vendor/cv-hallucination-guard/scripts/types.ts";

function atom(id: string, content: string, atomType = "achievement"): AtomLike {
  return {
    id,
    atom_type: atomType,
    content_no: content,
    content_en: null,
    structured_data: null,
    source_quote: null,
  } as unknown as AtomLike;
}

function currencyValue(text: string): number | null {
  const claim = extractNumberClaims(text).find(
    (c) => (c.parsed as { kind?: string }).kind === "currency",
  );
  return claim ? ((claim.parsed as { normalized_value: number }).normalized_value ?? null) : null;
}

function firstVerdict(text: string, atoms: AtomLike[]) {
  const claims = extractNumberClaims(text);
  const matches = matchHardClaims(claims, atoms);
  return matches[0]?.verdict ?? null;
}

describe("tallnormalisering — skala på tvers av språk", () => {
  it("3 billion tilsvarer 3 milliarder", () => {
    expect(currencyValue("NOK 3 billion")).toBe(3_000_000_000);
    expect(currencyValue("NOK 3 milliarder")).toBe(3_000_000_000);
    expect(currencyValue("NOK 3 mrd.")).toBe(3_000_000_000);
  });

  it("3 million er ikke 3 milliarder", () => {
    expect(currencyValue("NOK 3 million")).toBe(3_000_000);
    expect(currencyValue("NOK 3 million")).not.toBe(currencyValue("NOK 3 milliarder"));
  });

  it("desimalkomma og desimalpunkt gir samme verdi", () => {
    expect(currencyValue("NOK 4,5 mrd.")).toBe(4_500_000_000);
    expect(currencyValue("NOK 4.5 billion")).toBe(4_500_000_000);
  });

  it("tusenskilletegn tolkes som ett tall", () => {
    expect(currencyValue("NOK 1 500 000")).toBe(1_500_000);
    expect(currencyValue("NOK 1 500 000")).not.toBe(1500);
  });

  it("25 people tilsvarer 25 personer", () => {
    const no = extractNumberClaims("Ledet 25 personer").find(
      (c) => (c.parsed as { kind?: string }).kind === "headcount",
    );
    const en = extractNumberClaims("Led 25 people").find(
      (c) => (c.parsed as { kind?: string }).kind === "headcount",
    );
    expect((no?.parsed as { value: number }).value).toBe(25);
    expect((en?.parsed as { value: number }).value).toBe(25);
  });
});

describe("tallmatching mot atomer", () => {
  it("verifiserer beløp uttrykt på engelsk i grunnlaget", () => {
    const atoms = [atom("a1", "Grew the business to NOK 3 billion in annual revenue.")];
    expect(firstVerdict("Bygget virksomheten til NOK 3 milliarder i årlig omsetning.", atoms)).toBe(
      "verified",
    );
  });

  it("avviser feil størrelsesorden", () => {
    const atoms = [atom("a1", "Grew the business to NOK 3 million in annual revenue.")];
    expect(firstVerdict("Bygget virksomheten til NOK 3 milliarder i årlig omsetning.", atoms)).toBe(
      "unverified",
    );
  });

  it("verifiserer antall personer på tvers av språk", () => {
    const atoms = [atom("a1", "Led a team of 25 people across two countries.")];
    expect(firstVerdict("Ledet 25 personer i to land.", atoms)).toBe("verified");
  });

  it("krever at tallet finnes i claimens supporting atoms, ikke et annet sted i snapshotet", () => {
    const supporting = [atom("a1", "Ansvar for salg i Norden.")];
    const elsewhereInSnapshot = [
      atom("a1", "Ansvar for salg i Norden."),
      atom("a2", "Grew the business to NOK 3 billion in annual revenue."),
    ];
    const claimText = "Bygget virksomheten til NOK 3 milliarder i årlig omsetning.";
    // Mot hele snapshotet finnes tallet — men det er ikke claimens grunnlag.
    expect(firstVerdict(claimText, elsewhereInSnapshot)).toBe("verified");
    // Mot claimens egne supporting atoms skal den ikke verifiseres.
    expect(firstVerdict(claimText, supporting)).toBe("unverified");
  });
});
