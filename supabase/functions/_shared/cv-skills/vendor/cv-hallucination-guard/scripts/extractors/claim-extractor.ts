// cv-hallucination-guard — Claim extractor
// Hovedmotor som kombinerer alle ekstrakter og returnerer alle claims i en tekst.

import type { AtomLike, ExtractedClaim } from "../types.ts";
import { extractNumberClaims } from "./number-extractor.ts";
import { extractDateClaims } from "./date-extractor.ts";
import { extractEntityClaims, buildEntityHintsFromAtoms } from "./entity-extractor.ts";

/**
 * Trekker ut alle claims fra en tekst, gitt brukerens atoms som kontekst
 * for entitet-deteksjon.
 */
export function extractAllClaims(
  text: string,
  atoms: AtomLike[],
): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];

  // Hard claims
  claims.push(...extractNumberClaims(text));
  claims.push(...extractDateClaims(text));

  const hints = buildEntityHintsFromAtoms(atoms);
  claims.push(...extractEntityClaims(text, hints));

  // Soft claims — verb-baserte handlinger
  claims.push(...extractVerbActionClaims(text));

  // Sorter etter posisjon i tekst
  claims.sort((a, b) => a.position - b.position);

  return claims;
}

// ---------------------------------------------------------------------------
// Verb-action extractor (soft claims)
// ---------------------------------------------------------------------------

// Sterke ledelses-verb som ofte krever støtte i atoms
const STRONG_VERBS_NO = [
  "etablerte", "bygde", "ledet", "drev", "transformerte", "snudde",
  "lanserte", "vant", "lukket", "doblet", "tredoblet", "økte",
  "reduserte", "automatiserte", "rapporterte til", "var ansvarlig for",
];

const STRONG_VERBS_EN = [
  "established", "built", "led", "drove", "transformed", "turned around",
  "launched", "won", "closed", "doubled", "tripled", "grew",
  "reduced", "automated", "reported to", "owned",
];

function extractVerbActionClaims(text: string): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];
  const lowerText = text.toLowerCase();

  const allVerbs = [...STRONG_VERBS_NO, ...STRONG_VERBS_EN];

  for (const verb of allVerbs) {
    const regex = new RegExp(`\\b${escapeRegex(verb)}\\b`, "gi");
    for (const match of text.matchAll(regex)) {
      // Hent kontekst — opp til 80 tegn etter verbet
      const ctxStart = match.index ?? 0;
      const ctxEnd = Math.min(ctxStart + 80, text.length);
      const claimText = text.slice(ctxStart, ctxEnd).split(/[.,;]/)[0];

      claims.push({
        type: "verb_action",
        text: claimText.trim(),
        position: ctxStart,
        parsed: { verb, language: STRONG_VERBS_NO.includes(verb) ? "no" : "en" },
        is_hard: false,
      });
    }
  }

  return claims;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
