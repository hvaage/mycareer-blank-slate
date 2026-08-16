// cv-quality-no — Repetition check
// Fanger repetitive verb og adjektiver innen samme rolle eller hele CV.

import type { CheckInput, QualityIssue } from "../types.ts";

const REPETITION_VERB_THRESHOLD = 2;       // flagges hvis samme verb starter 3+ bullets
const REPETITION_ADJECTIVE_THRESHOLD = 2;  // flagges hvis samme adjektiv brukes 3+ ganger

export function checkRepetition(input: CheckInput): QualityIssue[] {
  if (!input.sibling_texts || input.sibling_texts.length === 0) return [];

  const issues: QualityIssue[] = [];
  const allTexts = [input.text, ...input.sibling_texts];

  // Sjekk åpningsverb
  const openingVerbs = allTexts.map((t) => extractFirstVerb(t));
  const verbCounts = new Map<string, number>();
  for (const verb of openingVerbs) {
    if (!verb) continue;
    const lower = verb.toLowerCase();
    verbCounts.set(lower, (verbCounts.get(lower) ?? 0) + 1);
  }

  const thisOpening = openingVerbs[0]?.toLowerCase();
  if (thisOpening && (verbCounts.get(thisOpening) ?? 0) > REPETITION_VERB_THRESHOLD) {
    issues.push({
      severity: "minor",
      category: "repetition",
      rule_id: "repetition.opening_verb",
      message: `Åpningsverbet "${openingVerbs[0]}" brukes ${verbCounts.get(thisOpening)} ganger i denne rollen.`,
      field_path: null,
      matched_text: openingVerbs[0],
      suggestion: "Variér åpningsverbene for bedre lesbarhet.",
    });
  }

  // Sjekk adjektiv-repetisjon i hele kontekst
  const fullText = allTexts.join(" ");
  const adjectiveCounts = countCommonAdjectives(fullText, input.language);
  for (const [adj, count] of adjectiveCounts.entries()) {
    if (count > REPETITION_ADJECTIVE_THRESHOLD && input.text.toLowerCase().includes(adj)) {
      issues.push({
        severity: "minor",
        category: "repetition",
        rule_id: "repetition.adjective",
        message: `Adjektivet "${adj}" brukes ${count} ganger.`,
        field_path: null,
        matched_text: adj,
        suggestion: "Variér eller fjern noen forekomster.",
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

function extractFirstVerb(text: string): string | null {
  const trimmed = text.trim();
  const firstWord = trimmed.split(/\s+/)[0];
  if (!firstWord) return null;
  // Fjern punktum og tegn
  return firstWord.replace(/[^\p{L}]/gu, "");
}

const COMMON_ADJECTIVES_NO = [
  "betydelig", "omfattende", "bred", "solid", "dyp", "stor", "viktig",
  "sentral", "avgjørende", "strategisk", "operasjonell", "effektiv",
  "innovativ", "dynamisk", "robust", "skalerbar", "bærekraftig",
];

const COMMON_ADJECTIVES_EN = [
  "significant", "extensive", "broad", "solid", "deep", "key", "central",
  "critical", "strategic", "operational", "effective", "innovative",
  "dynamic", "robust", "scalable", "sustainable", "passionate", "driven",
];

function countCommonAdjectives(
  text: string,
  language: "no" | "en",
): Map<string, number> {
  const list = language === "no" ? COMMON_ADJECTIVES_NO : COMMON_ADJECTIVES_EN;
  const counts = new Map<string, number>();
  const lower = text.toLowerCase();

  for (const adj of list) {
    const regex = new RegExp(`\\b${adj}\\b`, "gi");
    const matches = lower.match(regex);
    if (matches && matches.length > 0) {
      counts.set(adj, matches.length);
    }
  }

  return counts;
}
