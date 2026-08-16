// cv-hallucination-guard — Semantic matcher (lettvekts, uten LLM)
// Brukes som første pass for soft claims. Kan bekrefte trivielle matches uten
// å kalle Claude API. Mer komplekse soft claims sendes videre til llm-judge.

import type { AtomLike, ClaimMatch, ExtractedClaim } from "../types.ts";

/**
 * Lettvekts semantisk match for soft claims.
 * Returnerer ClaimMatch med verdict "verified", "partial" eller "unverified".
 *
 * Strategien er Jaccard-similaritet mellom claim-tekst og atom-content.
 * Et høyt overlapp (≥ 0.4) regnes som verifisert, lavere som partial,
 * ingen tokens i common som unverified.
 *
 * Ikke pålitelig for omformuleringer eller oversettelser — for det trengs
 * LLM-judge.
 */
export function matchSoftClaimsLight(
  claims: ExtractedClaim[],
  atoms: AtomLike[],
): ClaimMatch[] {
  return claims
    .filter((c) => !c.is_hard)
    .map((c) => matchSingleSoftClaim(c, atoms));
}

function matchSingleSoftClaim(
  claim: ExtractedClaim,
  atoms: AtomLike[],
): ClaimMatch {
  let bestSimilarity = 0;
  let bestAtomId: string | null = null;

  for (const atom of atoms) {
    const haystack = atomText(atom);
    const sim = jaccardSimilarity(claim.text, haystack);
    if (sim > bestSimilarity) {
      bestSimilarity = sim;
      bestAtomId = atom.id;
    }
  }

  if (bestSimilarity >= 0.4 && bestAtomId) {
    return {
      claim,
      verdict: "verified",
      confidence: Math.min(0.85, bestSimilarity + 0.3),
      supporting_atom_ids: [bestAtomId],
      reasoning: `Semantisk match (Jaccard=${bestSimilarity.toFixed(2)}).`,
    };
  }

  if (bestSimilarity >= 0.2 && bestAtomId) {
    return {
      claim,
      verdict: "partial",
      confidence: bestSimilarity,
      supporting_atom_ids: [bestAtomId],
      reasoning: `Svak semantisk match (Jaccard=${bestSimilarity.toFixed(2)}). Vurder med LLM-judge.`,
    };
  }

  return {
    claim,
    verdict: "unverified",
    confidence: 0.3,
    supporting_atom_ids: [],
    reasoning: "Ingen meningsbærende overlapp med atoms.",
  };
}

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

function atomText(atom: AtomLike): string {
  return `${atom.content_no ?? ""} ${atom.content_en ?? ""}`.trim();
}

function jaccardSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 && tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) if (tokensB.has(t)) intersection++;
  const union = tokensA.size + tokensB.size - intersection;

  return intersection / union;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS_NO.has(t) && !STOPWORDS_EN.has(t)),
  );
}

const STOPWORDS_NO = new Set([
  "med", "som", "for", "fra", "til", "ved", "også", "eller", "men", "ikke",
  "ble", "blir", "var", "har", "hadde", "den", "det", "deres", "disse",
  "denne", "dette", "etter", "ganske", "godt",
]);

const STOPWORDS_EN = new Set([
  "the", "and", "for", "with", "from", "this", "that", "have", "has", "was",
  "were", "been", "are", "their", "these", "those", "into", "across",
]);
