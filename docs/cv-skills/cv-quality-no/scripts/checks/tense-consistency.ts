// cv-quality-no — Tense consistency check
// Sjekker at verb-tid er konsistent mellom bullets innen samme rolle.

import type { CheckInput, QualityIssue } from "../types.ts";

// ---------------------------------------------------------------------------
// Verb-tid-deteksjon (heuristisk, ikke perfekt)
// ---------------------------------------------------------------------------

// Norske preteritum-suffikser (svake verb) — endelser
const NO_PRETERITUM_SUFFIXES = [
  "te", "de", "et", "tet", "dde", "rte", "kte", "ket", "lte", "lt", "rdte",
];

// Vanlige norske preteritum-former (sterke verb og uregelrette)
const NO_PRETERITUM_VERBS = new Set([
  "ledet", "drev", "etablerte", "bygde", "vant", "lukket", "doblet",
  "tredoblet", "økte", "reduserte", "automatiserte", "transformerte",
  "snudde", "lanserte", "leverte", "designet", "implementerte",
  "integrerte", "migrerte", "skalerte", "optimerte", "effektiviserte",
  "standardiserte", "konsoliderte", "restrukturerte", "definerte",
  "sikret", "forhandlet", "anførte", "iverksatte", "drev", "eide",
]);

// Vanlige norske presens-former
const NO_PRESENS_VERBS = new Set([
  "leder", "driver", "etablerer", "bygger", "vinner", "lukker", "dobler",
  "øker", "reduserer", "automatiserer", "transformerer", "snur",
  "lanserer", "leverer", "designer", "implementerer", "integrerer",
  "skalerer", "optimerer", "effektiviserer", "standardiserer",
  "definerer", "sikrer", "forhandler", "iverksetter", "eier", "har",
]);

// Engelske preteritum (regular: -ed, irregular: explicit)
const EN_PRETERITUM_VERBS = new Set([
  "led", "drove", "built", "won", "closed", "doubled", "tripled", "grew",
  "reduced", "automated", "transformed", "launched", "delivered",
  "designed", "implemented", "integrated", "scaled", "owned", "drove",
  "established", "founded", "spearheaded",
]);

const EN_PRESENS_VERBS = new Set([
  "lead", "drive", "build", "win", "close", "double", "grow", "reduce",
  "automate", "transform", "launch", "deliver", "design", "implement",
  "scale", "own", "establish",
]);

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

export function checkTenseConsistency(input: CheckInput): QualityIssue[] {
  if (input.context !== "achievement") return [];
  if (!input.sibling_texts || input.sibling_texts.length === 0) return [];

  const issues: QualityIssue[] = [];

  // Forventet tid basert på is_current_role
  const expectedTense = input.is_current_role ? "presens" : "preteritum";

  const allTexts = [input.text, ...input.sibling_texts];
  const tenses = allTexts.map((t) => detectTense(t, input.language));

  // Tell hvor mange er i hver tid
  const counts = { preteritum: 0, presens: 0, infinitive: 0, unknown: 0 };
  for (const t of tenses) counts[t]++;

  // Hvis blandet preteritum og presens, flagg
  if (counts.preteritum > 0 && counts.presens > 0) {
    const detectedThis = tenses[0];

    if (detectedThis === "preteritum" && expectedTense === "presens") {
      issues.push({
        severity: "important",
        category: "tense_consistency",
        rule_id: "tense_consistency.past_in_current",
        message: "Bullet er i preteritum, men dette er en pågående rolle.",
        field_path: null,
        matched_text: getFirstVerb(input.text),
        suggestion: "Bytt verbet til presens for konsistens med rollen.",
      });
    } else if (detectedThis === "presens" && expectedTense === "preteritum") {
      issues.push({
        severity: "important",
        category: "tense_consistency",
        rule_id: "tense_consistency.present_in_past",
        message: "Bullet er i presens, men rollen er avsluttet.",
        field_path: null,
        matched_text: getFirstVerb(input.text),
        suggestion: "Bytt verbet til preteritum.",
      });
    } else if (counts.preteritum >= 2 && counts.presens >= 2) {
      // Genuint blandet — flagg som inkonsistens
      issues.push({
        severity: "important",
        category: "tense_consistency",
        rule_id: "tense_consistency.mixed",
        message: "Bullets innenfor denne rollen blander preteritum og presens.",
        field_path: null,
        matched_text: null,
        suggestion: `Velg én tid for hele rollen (forventet: ${expectedTense}).`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Verb-tid-deteksjon
// ---------------------------------------------------------------------------

function detectTense(
  text: string,
  language: "no" | "en",
): "preteritum" | "presens" | "infinitive" | "unknown" {
  const trimmed = text.trim();

  // Sjekk infinitiv først
  if (language === "no" && /^å\s+\w+/i.test(trimmed)) return "infinitive";
  if (language === "en" && /^to\s+\w+/i.test(trimmed)) return "infinitive";

  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase().replace(/[^\p{L}]/gu, "");
  if (!firstWord) return "unknown";

  if (language === "no") {
    if (NO_PRETERITUM_VERBS.has(firstWord)) return "preteritum";
    if (NO_PRESENS_VERBS.has(firstWord)) return "presens";

    // Heuristikk: norsk preteritum ender ofte på -te/-de/-et
    for (const suffix of NO_PRETERITUM_SUFFIXES) {
      if (firstWord.endsWith(suffix) && firstWord.length > suffix.length + 2) {
        return "preteritum";
      }
    }
    // Norsk presens ender ofte på -er
    if (firstWord.endsWith("er") && firstWord.length > 4) return "presens";
  } else {
    if (EN_PRETERITUM_VERBS.has(firstWord)) return "preteritum";
    if (EN_PRESENS_VERBS.has(firstWord)) return "presens";

    // Heuristikk: engelsk preteritum ender ofte på -ed
    if (firstWord.endsWith("ed") && firstWord.length > 4) return "preteritum";
    if (firstWord.endsWith("s") && firstWord.length > 3) return "presens";
  }

  return "unknown";
}

function getFirstVerb(text: string): string {
  const firstWord = text.trim().split(/\s+/)[0] ?? "";
  return firstWord;
}
