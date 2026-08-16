// cv-quality-no — AI-tells check
// Fanger klisjéer og fraser som typisk avslører AI-generert tekst.

import type { CheckInput, QualityIssue } from "../types.ts";

// ---------------------------------------------------------------------------
// Mønster-tabell
// ---------------------------------------------------------------------------

interface AiTellPattern {
  pattern: RegExp;
  matched_text_label: string;
  message: string;
  suggestion: string;
  severity: "critical" | "important" | "minor";
  language: "no" | "en";
}

const AI_TELL_PATTERNS: AiTellPattern[] = [
  // === Norsk — generiske resultat-fraser ===
  {
    pattern: /\bhar\s+spilt\s+(?:en\s+)?(?:viktig|sentral|avgjørende|nøkkel)?\s*rolle\b/i,
    matched_text_label: "har spilt en avgjørende rolle",
    message: "Generisk resultat-frase som ikke forklarer hva som faktisk ble gjort.",
    suggestion: "Beskriv konkret handling: hva du ledet, designet eller bygde.",
    severity: "critical",
    language: "no",
  },
  {
    pattern: /\btransformerte\s+landskapet\b/i,
    matched_text_label: "transformerte landskapet",
    message: "Klisjé som ikke beskriver noe konkret.",
    suggestion: "Beskriv hva som faktisk ble endret med målbart resultat.",
    severity: "critical",
    language: "no",
  },
  {
    pattern: /\brevolusjonerte\b/i,
    matched_text_label: "revolusjonerte",
    message: "Overdreven og generisk.",
    suggestion: "Bytt til Lanserte, Etablerte, Bygde eller annet konkret verb.",
    severity: "critical",
    language: "no",
  },
  {
    pattern: /\bparadigme[\-\s]?skifte\b/i,
    matched_text_label: "paradigme-skifte",
    message: "Klisjé.",
    suggestion: "Beskriv den konkrete endringen.",
    severity: "critical",
    language: "no",
  },
  // === Norsk — strategi-buzzwords ===
  {
    pattern: /\bi\s+tråd\s+med\s+(?:strategiske|organisasjonens)\s+(?:målsettinger|visjon|mål)\b/i,
    matched_text_label: "i tråd med strategiske målsettinger",
    message: "Tom strategi-frase som ikke tilfører innhold.",
    suggestion: "Hvis koblingen til strategi er viktig: beskriv hvilken strategi konkret. Ellers fjern.",
    severity: "important",
    language: "no",
  },
  {
    pattern: /\bgjennom\s+datadre(?:vet|ven)\s+beslutnings(?:taking|prosess)?\b/i,
    matched_text_label: "gjennom datadreven beslutningstaking",
    message: "Generisk — beskriver ikke hva som ble gjort.",
    suggestion: "Beskriv hvilke data som ble brukt, og til hva.",
    severity: "important",
    language: "no",
  },
  {
    pattern: /\bmed\s+fokus\s+på\s+resultat(?:er)?\s+og\s+kontinuerlig\s+forbedring\b/i,
    matched_text_label: "med fokus på resultater og kontinuerlig forbedring",
    message: "Tom føleformulering.",
    suggestion: "Fjern frasen. Resultatene i bulletten taler for seg selv.",
    severity: "critical",
    language: "no",
  },
  {
    pattern: /\bpå\s+en\s+(?:bærekraftig|proaktiv|strukturert|helhetlig)\s+måte\b/i,
    matched_text_label: "på en bærekraftig/proaktiv/strukturert måte",
    message: "Adverbial-fluff som ikke konkretiserer.",
    suggestion: "Fjern. Bytt eventuelt til konkret tilnærming hvis det er essensielt.",
    severity: "important",
    language: "no",
  },
  {
    pattern: /\bbetydelig\s+vekst\b/i,
    matched_text_label: "betydelig vekst",
    message: "Vag forsterker uten tall.",
    suggestion: "Hvis du har konkret tall: bruk det. Hvis ikke: fjern frasen.",
    severity: "important",
    language: "no",
  },
  {
    pattern: /\b(?:omfattende|bred|solid|dyp)\s+(?:erfaring|kompetanse|innsikt|bakgrunn)\b/i,
    matched_text_label: "omfattende/bred/solid/dyp erfaring/kompetanse",
    message: "Vag forsterker — viser ikke spesifikt hva.",
    suggestion: "Erstatt med konkret kompetanse, antall år eller domener.",
    severity: "important",
    language: "no",
  },
  {
    pattern: /\bskapt\s+verdi\b/i,
    matched_text_label: "skapt verdi",
    message: "Generisk frase.",
    suggestion: "Beskriv hvordan og målbart for hvem.",
    severity: "important",
    language: "no",
  },
  {
    pattern: /\bpå\s+tvers\s+av\s+siloer\b/i,
    matched_text_label: "på tvers av siloer",
    message: "Klisjé fra moderne organisasjonsspråk.",
    suggestion: "Si konkret hvilke avdelinger eller funksjoner.",
    severity: "important",
    language: "no",
  },
  // === Engelsk ===
  {
    pattern: /\bpassionate\s+about\b/i,
    matched_text_label: "passionate about",
    message: "Generic CV cliché. Avoid.",
    suggestion: "Replace with concrete experience or remove.",
    severity: "critical",
    language: "en",
  },
  {
    pattern: /\bproven\s+track\s+record\b/i,
    matched_text_label: "proven track record",
    message: "Cliché — every CV claims this.",
    suggestion: "Replace with concrete results.",
    severity: "important",
    language: "en",
  },
  {
    pattern: /\bresults[\-\s]driven\b/i,
    matched_text_label: "results-driven",
    message: "Generic descriptor.",
    suggestion: "Show results in bullets — don't claim the trait.",
    severity: "important",
    language: "en",
  },
  {
    pattern: /\bdetail[\-\s]oriented\b/i,
    matched_text_label: "detail-oriented",
    message: "Generic descriptor.",
    suggestion: "Show through specific examples — remove the claim.",
    severity: "important",
    language: "en",
  },
  {
    pattern: /\bteam\s+player\b/i,
    matched_text_label: "team player",
    message: "Cliché.",
    suggestion: "Show through specific collaboration examples.",
    severity: "important",
    language: "en",
  },
  {
    pattern: /\b(?:transformed|disrupted|revolutionized)\s+the\s+(?:landscape|industry|market|game)\b/i,
    matched_text_label: "transformed/disrupted/revolutionized the landscape/industry",
    message: "Overhyped cliché.",
    suggestion: "State the concrete change with metrics.",
    severity: "critical",
    language: "en",
  },
  {
    pattern: /\bdata[\-\s]driven\s+decision\s+making\b/i,
    matched_text_label: "data-driven decision making",
    message: "Generic buzzword.",
    suggestion: "Specify what data and what decisions.",
    severity: "important",
    language: "en",
  },
  {
    pattern: /\bcross[\-\s]functional\s+collaboration\b/i,
    matched_text_label: "cross-functional collaboration",
    message: "Generic phrase — describes everyone's job.",
    suggestion: "Specify which functions and what was achieved.",
    severity: "minor",
    language: "en",
  },
  {
    pattern: /\bbest[\-\s]in[\-\s]class\b/i,
    matched_text_label: "best-in-class",
    message: "Self-aggrandizing claim.",
    suggestion: "Show evidence — top quartile, beat benchmark, etc.",
    severity: "important",
    language: "en",
  },
  {
    pattern: /\bcustomer[\-\s]centric\s+approach\b/i,
    matched_text_label: "customer-centric approach",
    message: "Buzzword.",
    suggestion: "Show specific customer-focused outcomes.",
    severity: "minor",
    language: "en",
  },
];

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

export function checkAiTells(input: CheckInput): QualityIssue[] {
  const issues: QualityIssue[] = [];

  for (const pattern of AI_TELL_PATTERNS) {
    if (pattern.language !== input.language) continue;
    const match = input.text.match(pattern.pattern);
    if (match) {
      issues.push({
        severity: pattern.severity,
        category: "ai_tell",
        rule_id: `ai_tell.${pattern.matched_text_label.toLowerCase().replace(/[^\w]+/g, "_")}`,
        message: pattern.message,
        field_path: null,
        matched_text: match[0],
        suggestion: pattern.suggestion,
      });
    }
  }

  return issues;
}
