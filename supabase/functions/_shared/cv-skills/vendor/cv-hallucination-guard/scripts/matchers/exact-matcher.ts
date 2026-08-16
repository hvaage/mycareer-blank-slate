// cv-hallucination-guard — Exact matcher
// Matcher hard claims (tall, datoer, entiteter) eksakt mot atoms.

import type { AtomLike, ClaimMatch, ExtractedClaim, MatchVerdict } from "../types.ts";
import { extractNumberClaims } from "../extractors/number-extractor.ts";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function matchHardClaims(
  claims: ExtractedClaim[],
  atoms: AtomLike[],
): ClaimMatch[] {
  return claims
    .filter((c) => c.is_hard)
    .map((c) => matchSingleClaim(c, atoms));
}

function matchSingleClaim(
  claim: ExtractedClaim,
  atoms: AtomLike[],
): ClaimMatch {
  switch (claim.type) {
    case "number":
      return matchNumberClaim(claim, atoms);
    case "date":
      return matchDateClaim(claim, atoms);
    case "entity":
      return matchEntityClaim(claim, atoms);
    default:
      return defaultUnverified(claim, "Type ikke håndtert av eksakt-matcher.");
  }
}

// ---------------------------------------------------------------------------
// Number matcher
// ---------------------------------------------------------------------------

function matchNumberClaim(claim: ExtractedClaim, atoms: AtomLike[]): ClaimMatch {
  const parsed = claim.parsed as Record<string, unknown>;
  const kind = parsed.kind as string;

  if (kind === "currency") {
    return matchCurrencyClaim(claim, atoms);
  }
  if (kind === "percent") {
    return matchPercentClaim(claim, atoms);
  }
  if (kind === "headcount") {
    return matchHeadcountClaim(claim, atoms);
  }
  if (kind === "multiplier") {
    return matchMultiplierClaim(claim, atoms);
  }

  return defaultUnverified(claim, `Tall-type "${kind}" ikke håndtert.`);
}

function matchCurrencyClaim(claim: ExtractedClaim, atoms: AtomLike[]): ClaimMatch {
  const parsed = claim.parsed as { currency: string; normalized_value: number };

  // Søk i metric-atoms og achievement-atoms
  for (const atom of atoms) {
    if (atom.atom_type !== "metric") continue;
    const sd = (atom.structured_data ?? {}) as Record<string, unknown>;
    const atomValue = typeof sd.value === "number" ? sd.value : NaN;
    const atomUnit = typeof sd.unit === "string" ? sd.unit.toUpperCase() : "";

    if (!Number.isFinite(atomValue)) continue;
    if (atomUnit !== parsed.currency && !atomUnit.includes(parsed.currency)) continue;

    const verdict = compareWithTolerance(parsed.normalized_value, atomValue, 0.20);
    if (verdict !== "unverified") {
      return {
        claim,
        verdict,
        confidence: verdict === "verified" ? 0.95 : 0.7,
        supporting_atom_ids: [atom.id],
        reasoning: verdict === "verified"
          ? `Match mot metric-atom (${atomValue} ${atomUnit}).`
          : `Lignende verdi i atom (${atomValue} ${atomUnit}), men avvik over toleransegrense.`,
      };
    }
  }

  // Sjekk også role.structured_data og achievement.structured_data tekst-felter
  for (const atom of atoms) {
    const haystack = atomTextHaystack(atom).toLowerCase();
    if (haystack.includes(claim.text.toLowerCase())) {
      return {
        claim,
        verdict: "verified",
        confidence: 0.85,
        supporting_atom_ids: [atom.id],
        reasoning: "Eksakt tekst-match i atom-innhold.",
      };
    }
  }

  // Samme beløp uttrykt på et annet språk i atom-teksten
  // (f.eks. "NOK 3 billion" i grunnlaget vs. "NOK 3 milliarder" i teksten).
  for (const atom of atoms) {
    for (const atomClaim of extractNumberClaims(atomTextHaystack(atom))) {
      const p = atomClaim.parsed as { kind?: string; currency?: string; normalized_value?: number };
      if (p.kind !== "currency") continue;
      if (p.currency !== parsed.currency) continue;
      if (p.normalized_value !== parsed.normalized_value) continue;
      return {
        claim,
        verdict: "verified",
        confidence: 0.85,
        supporting_atom_ids: [atom.id],
        reasoning: "Samme beløp finnes i atom-innholdet.",
      };
    }
  }

  return defaultUnverified(claim, "Ingen matchende beløp funnet i atoms.");
}


function matchPercentClaim(claim: ExtractedClaim, atoms: AtomLike[]): ClaimMatch {
  const parsed = claim.parsed as { value: number };

  for (const atom of atoms) {
    if (atom.atom_type !== "metric") continue;
    const sd = (atom.structured_data ?? {}) as Record<string, unknown>;
    const atomUnit = typeof sd.unit === "string" ? sd.unit : "";
    if (atomUnit !== "%") continue;

    const atomValue = typeof sd.value === "number" ? sd.value : NaN;
    const verdict = compareWithTolerance(parsed.value, atomValue, 0.15);
    if (verdict !== "unverified") {
      return {
        claim,
        verdict,
        confidence: verdict === "verified" ? 0.95 : 0.7,
        supporting_atom_ids: [atom.id],
        reasoning: verdict === "verified"
          ? `Match mot prosent-atom (${atomValue} %).`
          : `Lignende prosent (${atomValue} %), men avvik over toleranse.`,
      };
    }
  }

  // Tekst-match som fallback
  for (const atom of atoms) {
    const haystack = atomTextHaystack(atom);
    if (haystack.includes(`${parsed.value} %`) || haystack.includes(`${parsed.value}%`)) {
      return {
        claim,
        verdict: "verified",
        confidence: 0.85,
        supporting_atom_ids: [atom.id],
        reasoning: "Tekst-match for prosent-verdi.",
      };
    }
  }

  return defaultUnverified(claim, "Ingen matchende prosent-verdi funnet i atoms.");
}

function matchHeadcountClaim(claim: ExtractedClaim, atoms: AtomLike[]): ClaimMatch {
  const parsed = claim.parsed as { value: number };

  for (const atom of atoms) {
    if (atom.atom_type !== "achievement") continue;
    const sd = (atom.structured_data ?? {}) as Record<string, unknown>;
    const teamSize = typeof sd.scope_team_size === "number" ? sd.scope_team_size : null;
    if (teamSize == null) continue;

    const verdict = compareWithTolerance(parsed.value, teamSize, 0.20);
    if (verdict !== "unverified") {
      return {
        claim,
        verdict,
        confidence: verdict === "verified" ? 0.95 : 0.7,
        supporting_atom_ids: [atom.id],
        reasoning: verdict === "verified"
          ? `Match mot scope_team_size (${teamSize}).`
          : `Lignende team-størrelse (${teamSize}), men avvik over toleranse.`,
      };
    }
  }

  return defaultUnverified(claim, "Ingen matchende team-størrelse funnet i achievements.");
}

function matchMultiplierClaim(claim: ExtractedClaim, _atoms: AtomLike[]): ClaimMatch {
  // Multiplikatorer er sjelden direkte lagret som structured_data — sjekk tekst
  return defaultUnverified(
    claim,
    "Multiplikator-claims krever LLM-judge for tolkning.",
  );
}

// ---------------------------------------------------------------------------
// Date matcher
// ---------------------------------------------------------------------------

function matchDateClaim(claim: ExtractedClaim, atoms: AtomLike[]): ClaimMatch {
  const parsed = claim.parsed as Record<string, unknown>;
  const kind = parsed.kind as string;

  if (kind === "date_range") {
    return matchDateRange(claim, atoms);
  }
  if (kind === "single_year" || kind === "month_year") {
    return matchSingleYear(claim, atoms);
  }
  if (kind === "duration") {
    return matchDuration(claim, atoms);
  }

  return defaultUnverified(claim, `Dato-type "${kind}" ikke håndtert.`);
}

function matchDateRange(claim: ExtractedClaim, atoms: AtomLike[]): ClaimMatch {
  const parsed = claim.parsed as { start_year: number; end_year: number | null };

  for (const atom of atoms) {
    if (atom.atom_type !== "role" && atom.atom_type !== "education") continue;
    const sd = (atom.structured_data ?? {}) as Record<string, unknown>;

    let atomStartYear: number | null = null;
    let atomEndYear: number | null = null;

    if (atom.atom_type === "role") {
      const startDate = typeof sd.start_date === "string" ? sd.start_date : null;
      const endDate = typeof sd.end_date === "string" ? sd.end_date : null;
      if (startDate) atomStartYear = parseInt(startDate.split("-")[0], 10);
      if (endDate) atomEndYear = parseInt(endDate.split("-")[0], 10);
    } else {
      atomStartYear = typeof sd.start_year === "number" ? sd.start_year : null;
      atomEndYear = typeof sd.end_year === "number" ? sd.end_year : null;
    }

    if (atomStartYear == null) continue;

    const startMatch = atomStartYear === parsed.start_year;
    const endMatch = parsed.end_year === atomEndYear;

    if (startMatch && endMatch) {
      return {
        claim,
        verdict: "verified",
        confidence: 0.95,
        supporting_atom_ids: [atom.id],
        reasoning: `Match mot ${atom.atom_type} (${atomStartYear}–${atomEndYear ?? "pågående"}).`,
      };
    }
    if (startMatch || endMatch) {
      return {
        claim,
        verdict: "partial",
        confidence: 0.7,
        supporting_atom_ids: [atom.id],
        reasoning: `Delvis match mot ${atom.atom_type} (${atomStartYear}–${atomEndYear ?? "pågående"}).`,
      };
    }
  }

  return defaultUnverified(claim, "Ingen rolle eller utdanning matcher tidsperioden.");
}

function matchSingleYear(claim: ExtractedClaim, atoms: AtomLike[]): ClaimMatch {
  const parsed = claim.parsed as { year: number };

  for (const atom of atoms) {
    const haystack = atomTextHaystack(atom);
    if (haystack.includes(String(parsed.year))) {
      return {
        claim,
        verdict: "verified",
        confidence: 0.8,
        supporting_atom_ids: [atom.id],
        reasoning: `År ${parsed.year} finnes i atom-innhold.`,
      };
    }
  }

  return defaultUnverified(claim, `År ${parsed.year} ikke funnet i noen atoms.`);
}

function matchDuration(claim: ExtractedClaim, atoms: AtomLike[]): ClaimMatch {
  const parsed = claim.parsed as { value: number; unit: string };

  for (const atom of atoms) {
    if (atom.atom_type !== "role") continue;
    const sd = (atom.structured_data ?? {}) as Record<string, unknown>;
    const startDate = typeof sd.start_date === "string" ? sd.start_date : null;
    const endDate = typeof sd.end_date === "string" ? sd.end_date : null;
    if (!startDate) continue;

    const start = parseInt(startDate.split("-")[0], 10);
    const end = endDate ? parseInt(endDate.split("-")[0], 10) : new Date().getFullYear();
    const yearsInAtom = end - start;

    const claimYears = parsed.unit === "years" ? parsed.value : parsed.value / 12;
    const verdict = compareWithTolerance(claimYears, yearsInAtom, 0.25);
    if (verdict !== "unverified") {
      return {
        claim,
        verdict,
        confidence: verdict === "verified" ? 0.85 : 0.6,
        supporting_atom_ids: [atom.id],
        reasoning: verdict === "verified"
          ? `Varighet matcher rolle (${yearsInAtom} år).`
          : `Lignende varighet i rolle (${yearsInAtom} år), men avvik.`,
      };
    }
  }

  return defaultUnverified(claim, "Ingen rolle med matchende varighet.");
}

// ---------------------------------------------------------------------------
// Entity matcher
// ---------------------------------------------------------------------------

function matchEntityClaim(claim: ExtractedClaim, _atoms: AtomLike[]): ClaimMatch {
  // Entity-claims har allerede source_atom_id fra extractor
  const parsed = claim.parsed as { source_atom_id: string };
  return {
    claim,
    verdict: "verified",
    confidence: 1.0,
    supporting_atom_ids: [parsed.source_atom_id],
    reasoning: "Entitet matchet direkte mot atom-hint.",
  };
}

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

function compareWithTolerance(
  claimValue: number,
  atomValue: number,
  tolerance: number,
): MatchVerdict {
  if (atomValue === 0) {
    return claimValue === 0 ? "verified" : "contradicted";
  }
  const ratio = claimValue / atomValue;
  if (ratio >= 1 - tolerance && ratio <= 1 + tolerance) {
    return ratio === 1 ? "verified" : "partial";
  }
  if (ratio > 1 + tolerance) return "contradicted";  // claim er for høy
  return "unverified";  // claim er lavere — kan være avrunding ned, men flag det
}

function atomTextHaystack(atom: AtomLike): string {
  const sd = (atom.structured_data ?? {}) as Record<string, unknown>;
  return [
    atom.content_no ?? "",
    atom.content_en ?? "",
    Object.values(sd).filter((v) => typeof v === "string").join(" "),
  ].join(" ");
}

function defaultUnverified(claim: ExtractedClaim, reasoning: string): ClaimMatch {
  return {
    claim,
    verdict: "unverified",
    confidence: 0.5,
    supporting_atom_ids: [],
    reasoning,
  };
}
