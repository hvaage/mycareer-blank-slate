// cv-quality-no — Readability check
// Sjekker setningslengde, subordinasjon og generell leselighet.

import type { CheckInput, QualityIssue, TextContext } from "../types.ts";

interface LengthLimits {
  ideal_max: number;
  warn_at: number;
  critical_at: number;
}

const LENGTH_LIMITS: Record<TextContext, LengthLimits> = {
  achievement: { ideal_max: 18, warn_at: 25, critical_at: 35 },
  summary: { ideal_max: 22, warn_at: 30, critical_at: 40 },
  role_description: { ideal_max: 20, warn_at: 28, critical_at: 35 },
  cover_letter: { ideal_max: 25, warn_at: 35, critical_at: 45 },
};

const SUBORDINATION_WORDS_NO = new Set([
  "som", "at", "hvis", "når", "der", "mens", "selv om", "fordi", "ettersom",
  "siden",
]);

const SUBORDINATION_WORDS_EN = new Set([
  "that", "which", "who", "where", "when", "while", "because", "since",
  "although", "though", "if",
]);

export function checkReadability(input: CheckInput): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const limits = LENGTH_LIMITS[input.context];

  // Splitt i setninger
  const sentences = splitIntoSentences(input.text);

  sentences.forEach((sentence, idx) => {
    const wordCount = countWords(sentence);

    if (wordCount > limits.critical_at) {
      issues.push({
        severity: "important",
        category: "readability",
        rule_id: "readability.sentence_too_long_critical",
        message: `Setning ${idx + 1} er ${wordCount} ord — alt for lang.`,
        field_path: `sentence[${idx}]`,
        matched_text: sentence.slice(0, 60) + "…",
        suggestion: `Splitt eller komprimer. Mål: under ${limits.ideal_max} ord per setning.`,
      });
    } else if (wordCount > limits.warn_at) {
      issues.push({
        severity: "minor",
        category: "readability",
        rule_id: "readability.sentence_too_long",
        message: `Setning ${idx + 1} er ${wordCount} ord — over ideal-grense.`,
        field_path: `sentence[${idx}]`,
        matched_text: sentence.slice(0, 60) + "…",
        suggestion: `Vurder å forkorte til under ${limits.ideal_max} ord.`,
      });
    }

    // Sjekk subordinasjon-tetthet
    const subordinationCount = countSubordinationWords(sentence, input.language);
    if (subordinationCount > 3) {
      issues.push({
        severity: "minor",
        category: "readability",
        rule_id: "readability.too_much_subordination",
        message: `Setning ${idx + 1} har ${subordinationCount} leddsetnings-konjunksjoner.`,
        field_path: `sentence[${idx}]`,
        matched_text: sentence.slice(0, 60) + "…",
        suggestion: "Splitt opp i to eller flere setninger.",
      });
    }
  });

  // Sjekk for semikolon (Henrik liker ikke det — universell norsk CV-stil-preferanse)
  if (/;/.test(input.text)) {
    issues.push({
      severity: "info",
      category: "readability",
      rule_id: "readability.semicolon",
      message: "Inneholder semikolon.",
      field_path: null,
      matched_text: ";",
      suggestion: "Splitt setningen i to eller bytt med komma/punktum.",
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

function splitIntoSentences(text: string): string[] {
  // Splitt på .!? men ikke inne i forkortelser (jan., f.eks.)
  return text
    .split(/(?<![A-Za-z])\.(?:\s+|$)|!\s+|\?\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function countWords(text: string): number {
  return text
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w))
    .length;
}

function countSubordinationWords(text: string, language: "no" | "en"): number {
  const words = text.toLowerCase().split(/\s+/);
  const set = language === "no" ? SUBORDINATION_WORDS_NO : SUBORDINATION_WORDS_EN;
  let count = 0;
  for (const word of words) {
    const cleaned = word.replace(/[^\p{L}]/gu, "");
    if (set.has(cleaned)) count++;
  }
  return count;
}

export function computeStats(text: string): {
  word_count: number;
  sentence_count: number;
  avg_words_per_sentence: number;
} {
  const sentences = splitIntoSentences(text);
  const wordCount = countWords(text);
  return {
    word_count: wordCount,
    sentence_count: sentences.length,
    avg_words_per_sentence: sentences.length > 0
      ? Math.round((wordCount / sentences.length) * 10) / 10
      : 0,
  };
}
