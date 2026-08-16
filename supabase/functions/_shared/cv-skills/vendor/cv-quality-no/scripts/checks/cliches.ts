// cv-quality-no — Cliches check
// Fanger overdrevne adjektiver og selv-promotering uten støtte.

import type { CheckInput, QualityIssue } from "../types.ts";

interface ClichePattern {
  pattern: RegExp;
  matched_text_label: string;
  message: string;
  suggestion: string;
  severity: "critical" | "important" | "minor";
  language: "no" | "en";
}

const CLICHE_PATTERNS: ClichePattern[] = [
  // Norsk
  {
    pattern: /\bdynamisk\b/i,
    matched_text_label: "dynamisk",
    message: "Generisk adjektiv som ikke beskriver noe konkret.",
    suggestion: "Fjern, eller bytt til konkret kvalitet.",
    severity: "important",
    language: "no",
  },
  {
    pattern: /\binnovativ\b/i,
    matched_text_label: "innovativ",
    message: "Subjektivt — la resultatet snakke.",
    suggestion: "Fjern. Hvis du virkelig var innovativ: vis det med konkret eksempel.",
    severity: "important",
    language: "no",
  },
  {
    pattern: /\bpassionate\b/i,
    matched_text_label: "passionate",
    message: "Engelsk-isme og klisjé.",
    suggestion: "Fjern.",
    severity: "critical",
    language: "no",
  },
  {
    pattern: /\b(?:exceptional|outstanding)\b/i,
    matched_text_label: "exceptional / outstanding",
    message: "Selv-promotering uten støtte.",
    suggestion: "Fjern. Vis kvaliteten gjennom konkrete tall og resultater.",
    severity: "important",
    language: "no",
  },
  {
    pattern: /\bworld[\-\s]class\b/i,
    matched_text_label: "world-class",
    message: "Overdrivelse.",
    suggestion: "Fjern, eller bytt med konkret benchmark.",
    severity: "critical",
    language: "no",
  },
  {
    pattern: /\bcutting[\-\s]edge\b/i,
    matched_text_label: "cutting-edge",
    message: "Klisjé fra teknologi-markedsføring.",
    suggestion: "Beskriv konkret teknologi.",
    severity: "important",
    language: "no",
  },
  {
    pattern: /\bbest[\-\s]in[\-\s]class\b/i,
    matched_text_label: "best-in-class",
    message: "Selv-promotering uten benchmark.",
    suggestion: "Fjern, eller vis benchmark-tall.",
    severity: "important",
    language: "no",
  },
  // Engelsk
  {
    pattern: /\b(?:dynamic|innovative)\b/i,
    matched_text_label: "dynamic / innovative",
    message: "Generic adjective without supporting evidence.",
    suggestion: "Remove or replace with concrete trait.",
    severity: "important",
    language: "en",
  },
  {
    pattern: /\b(?:exceptional|outstanding|talented)\b/i,
    matched_text_label: "exceptional / outstanding / talented",
    message: "Self-promotion without evidence.",
    suggestion: "Remove. Show quality through specific results.",
    severity: "important",
    language: "en",
  },
  {
    pattern: /\b(?:passionate|driven|motivated)\b/i,
    matched_text_label: "passionate / driven / motivated",
    message: "Generic CV cliché.",
    suggestion: "Remove or show through specific examples.",
    severity: "critical",
    language: "en",
  },
  {
    pattern: /\bworld[\-\s]class\b/i,
    matched_text_label: "world-class",
    message: "Overstatement.",
    suggestion: "Replace with concrete benchmark.",
    severity: "critical",
    language: "en",
  },
  {
    pattern: /\bcutting[\-\s]edge\b/i,
    matched_text_label: "cutting-edge",
    message: "Marketing cliché.",
    suggestion: "Name the specific technology.",
    severity: "important",
    language: "en",
  },
  {
    pattern: /\benterprise[\-\s]grade\b/i,
    matched_text_label: "enterprise-grade",
    message: "Marketing buzzword.",
    suggestion: "Show specific scale (users, transactions, uptime).",
    severity: "minor",
    language: "en",
  },
  {
    pattern: /\bsynergize\b/i,
    matched_text_label: "synergize",
    message: "Buzzword cliché.",
    suggestion: "Use a concrete verb.",
    severity: "critical",
    language: "en",
  },
  {
    pattern: /\bmove\s+the\s+needle\b/i,
    matched_text_label: "move the needle",
    message: "Cliché.",
    suggestion: "State the specific metric and its change.",
    severity: "important",
    language: "en",
  },
];

export function checkCliches(input: CheckInput): QualityIssue[] {
  const issues: QualityIssue[] = [];

  for (const pattern of CLICHE_PATTERNS) {
    if (pattern.language !== input.language) continue;
    const match = input.text.match(pattern.pattern);
    if (match) {
      issues.push({
        severity: pattern.severity,
        category: "cliche",
        rule_id: `cliche.${pattern.matched_text_label.toLowerCase().replace(/[^\w]+/g, "_")}`,
        message: pattern.message,
        field_path: null,
        matched_text: match[0],
        suggestion: pattern.suggestion,
      });
    }
  }

  return issues;
}
