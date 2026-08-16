// cv-quality-no — Verb strength check
// Fanger svake åpningsverb og foreslår sterke alternativer.

import type { CheckInput, QualityIssue } from "../types.ts";

// ---------------------------------------------------------------------------
// Konstanter
// ---------------------------------------------------------------------------

interface WeakVerbPattern {
  pattern: RegExp;
  matched_text_label: string;
  message: string;
  suggestion: string;
  severity: "critical" | "important" | "minor";
  language: "no" | "en";
}

const WEAK_OPENINGS: WeakVerbPattern[] = [
  // Norsk
  {
    pattern: /^var\s+ansvarlig\s+for\b/i,
    matched_text_label: "Var ansvarlig for",
    message: "Svak åpning — generisk og signaliserer lite konkret eierskap.",
    suggestion: "Bytt til konkret verb: Ledet, Drev, Eide, Bygde.",
    severity: "important",
    language: "no",
  },
  {
    pattern: /^hjalp\s+(?:til\s+med|med)\b/i,
    matched_text_label: "Hjalp til med / Hjalp med",
    message: "Svak åpning — devalverer rollen til assistanse.",
    suggestion: "Hvis du faktisk ledet eller drev: bruk konkret verb. Hvis du virkelig var assistent: vurder å fjerne bulletten.",
    severity: "critical",
    language: "no",
  },
  {
    pattern: /^bidro\s+til\b/i,
    matched_text_label: "Bidro til",
    message: "Svak åpning — leser tenker 'hvor mye?'.",
    suggestion: "Hvis du eide initiativet: bruk Ledet, Drev. Hvis du faktisk bidro til kollektivt arbeid: behold med konkret detalj.",
    severity: "important",
    language: "no",
  },
  {
    pattern: /^var\s+involvert\s+i\b/i,
    matched_text_label: "Var involvert i",
    message: "Helt tom formulering — sier ingenting om rollen.",
    suggestion: "Bruk konkret verb: Designet, Implementerte, Ledet, Bidro til.",
    severity: "critical",
    language: "no",
  },
  {
    pattern: /^var\s+del\s+av\b/i,
    matched_text_label: "Var del av",
    message: "Passiv plassering — ikke handling.",
    suggestion: "Hvis det er om ledergruppe-medlemskap: behold med konkret kontekst. Ellers bruk konkret verb.",
    severity: "important",
    language: "no",
  },
  {
    pattern: /^jobbet\s+med\b/i,
    matched_text_label: "Jobbet med",
    message: "For generelt — alle 'jobber med' noe.",
    suggestion: "Bruk konkret verb som beskriver hva du faktisk gjorde.",
    severity: "important",
    language: "no",
  },
  {
    pattern: /^var\s+med\s+på\s+å\b/i,
    matched_text_label: "Var med på å",
    message: "Devalverende — signaliserer assistent-rolle.",
    suggestion: "Hvis du eide: bruk konkret verb. Ellers: vurder å fjerne.",
    severity: "critical",
    language: "no",
  },
  {
    pattern: /^tok\s+del\s+i\b/i,
    matched_text_label: "Tok del i",
    message: "Passiv — bytt til konkret handling.",
    suggestion: "Bruk verb som beskriver din konkrete rolle.",
    severity: "important",
    language: "no",
  },
  {
    pattern: /^spilte\s+(?:en\s+)?(?:viktig\s+|sentral\s+|avgjørende\s+)?rolle\s+i\b/i,
    matched_text_label: "Spilte en rolle i",
    message: "Direkte oversettelse av engelsk 'played a role in'. Generisk.",
    suggestion: "Beskriv hva rollen faktisk var: Ledet, Designet, Drev.",
    severity: "critical",
    language: "no",
  },
  {
    pattern: /^å\s+\w+/i,
    matched_text_label: "Infinitiv-åpning (Å …)",
    message: "Bullet starter med infinitiv. CV-bullets skal starte med finitt verb.",
    suggestion: "Bytt 'Å bygge teamet…' til 'Bygde teamet…'.",
    severity: "important",
    language: "no",
  },
  // Engelsk
  {
    pattern: /^was\s+responsible\s+for\b/i,
    matched_text_label: "Was responsible for",
    message: "Weak opening — signals scope but not action.",
    suggestion: "Use a concrete verb: Led, Owned, Drove, Built.",
    severity: "important",
    language: "en",
  },
  {
    pattern: /^helped\s+(?:to\s+)?\b/i,
    matched_text_label: "Helped (to)",
    message: "Devalues your role — signals assistance.",
    suggestion: "If you owned: use concrete verb. If truly assistance: consider removing.",
    severity: "critical",
    language: "en",
  },
  {
    pattern: /^assisted\s+(?:with|in)\b/i,
    matched_text_label: "Assisted with",
    message: "Devalues your role.",
    suggestion: "Use a concrete verb that describes what you did.",
    severity: "critical",
    language: "en",
  },
  {
    pattern: /^worked\s+(?:on|with)\b/i,
    matched_text_label: "Worked on/with",
    message: "Too generic — everyone works on things.",
    suggestion: "Describe the specific action: Designed, Built, Led.",
    severity: "important",
    language: "en",
  },
  {
    pattern: /^was\s+part\s+of\b/i,
    matched_text_label: "Was part of",
    message: "Passive placement — not action.",
    suggestion: "Use a concrete verb describing your role.",
    severity: "important",
    language: "en",
  },
  {
    pattern: /^contributed\s+to\b/i,
    matched_text_label: "Contributed to",
    message: "Vague — reader wonders 'how much?'.",
    suggestion: "If you owned: use stronger verb. If truly collective: keep with concrete detail.",
    severity: "important",
    language: "en",
  },
];

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

export function checkVerbStrength(input: CheckInput): QualityIssue[] {
  const issues: QualityIssue[] = [];

  // Kun aktuelt for bullets — ikke for sammendrag eller rolle-beskrivelser
  if (input.context !== "achievement") return issues;

  const trimmed = input.text.trim();

  for (const pattern of WEAK_OPENINGS) {
    if (pattern.language !== input.language) continue;
    if (pattern.pattern.test(trimmed)) {
      issues.push({
        severity: pattern.severity,
        category: "verb_strength",
        rule_id: `verb_strength.weak_opening.${pattern.matched_text_label.toLowerCase().replace(/\s+/g, "_")}`,
        message: pattern.message,
        field_path: null,
        matched_text: pattern.matched_text_label,
        suggestion: pattern.suggestion,
      });
      break; // én flagging per bullet er nok
    }
  }

  return issues;
}
