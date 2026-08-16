// cv-ats-rules-no — Language-validator
// Sjekker norsk-spesifikke språkregler: æøå, tall-format, valuta, ord-blanding

import type { AtsViolation, CvDraft } from "../types.ts";

// ---------------------------------------------------------------------------
// Konstanter
// ---------------------------------------------------------------------------

// Engelske ord som ofte sniker seg inn i norske CV-er der norske ord er bedre
export const ENGLISH_WORDS_TO_AVOID_IN_NORWEGIAN: Readonly<Record<string, string>> = {
  manage: "lede / ha ansvar for",
  managed: "ledet",
  build: "bygge",
  built: "bygde",
  grow: "øke / bygge ut",
  grew: "økte",
  customer: "kunde",
  customers: "kunder",
  set: "etablerte",
  developed: "utviklet",
  delivered: "leverte",
  responsible: "ansvarlig",
} as const;

// Engelske begreper som er greit i norsk forretningsspråk
export const ACCEPTABLE_ENGLISH_TERMS: ReadonlySet<string> = new Set([
  "kpi", "okr", "meddpicc", "rfp", "saas", "b2b", "b2c", "ai", "ml",
  "arr", "mrr", "cac", "ltv", "nps", "csat", "roi",
  "pipeline", "deal", "deals", "account", "accounts", "crm",
  "api", "apis", "rest", "graphql", "rag", "llm", "mvp",
  "team", "teams", "lead", "leads",
  "performance", "kickoff",
]);

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export function validateLanguage(draft: CvDraft): AtsViolation[] {
  const violations: AtsViolation[] = [];

  if (draft.language === "no") {
    violations.push(...validateNorwegianContent(draft));
  } else {
    violations.push(...validateEnglishContent(draft));
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Norsk-validering
// ---------------------------------------------------------------------------

function validateNorwegianContent(draft: CvDraft): AtsViolation[] {
  const violations: AtsViolation[] = [];

  // Sjekk profilsammendrag
  if (draft.summary) {
    violations.push(...checkNorwegianText(draft.summary, "summary"));
  }

  // Sjekk hver bullet i hver rolle
  draft.roles.forEach((role, rIdx) => {
    role.achievements.forEach((bullet, bIdx) => {
      violations.push(
        ...checkNorwegianText(bullet, `roles[${rIdx}].achievements[${bIdx}]`),
      );
    });
    if (role.description) {
      violations.push(
        ...checkNorwegianText(role.description, `roles[${rIdx}].description`),
      );
    }
  });

  return violations;
}

function checkNorwegianText(text: string, fieldPath: string): AtsViolation[] {
  const violations: AtsViolation[] = [];

  // Sjekk for engelske ord
  const englishWords = findEnglishWordsInNorwegianText(text);
  if (englishWords.length > 0) {
    violations.push({
      severity: "warning",
      category: "language",
      rule_id: "language.english_in_norwegian",
      message: `Inneholder engelske ord som har norske ekvivalenter: ${englishWords.join(", ")}.`,
      field_path: fieldPath,
      suggestion: "Erstatt med norske ord der det passer naturlig.",
    });
  }

  // Sjekk for amerikansk tusenskille (komma) der norsk skille (mellomrom) bør brukes
  if (/\d{1,3}(,\d{3})+/.test(text)) {
    violations.push({
      severity: "warning",
      category: "language",
      rule_id: "language.us_thousand_separator",
      message: "Bruker amerikansk tusenskille (komma). Norsk standard er mellomrom.",
      field_path: fieldPath,
      suggestion: "Bytt 4,200,000 → 4 200 000.",
    });
  }

  // Sjekk for amerikansk desimal (punktum) i tydelig tallkontekst (f.eks. ÅÅÅÅ. eller "3.5%")
  if (/\b\d+\.\d+\s?(?:%|år|prosent|mill|mrd|kr|nok|usd|eur)/i.test(text)) {
    violations.push({
      severity: "warning",
      category: "language",
      rule_id: "language.us_decimal_separator",
      message: "Bruker amerikansk desimaltegn (punktum). Norsk standard er komma.",
      field_path: fieldPath,
      suggestion: "Bytt 3.5% → 3,5 %.",
    });
  }

  // Sjekk for prosent uten mellomrom (norsk standard er "40 %")
  if (/\d+%/.test(text) && !/\d+\s%/.test(text)) {
    violations.push({
      severity: "info",
      category: "language",
      rule_id: "language.percent_no_space",
      message: "Norsk standard har mellomrom mellom tall og prosenttegn.",
      field_path: fieldPath,
      suggestion: "Bytt 40% → 40 %.",
    });
  }

  // Sjekk for emoji eller forbudte tegn
  if (/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]/u.test(text)) {
    violations.push({
      severity: "error",
      category: "language",
      rule_id: "language.emoji",
      message: "Inneholder emoji som kan bryte ATS-parsing.",
      field_path: fieldPath,
      suggestion: "Fjern emoji.",
    });
  }

  return violations;
}

function findEnglishWordsInNorwegianText(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const found: string[] = [];
  for (const word of words) {
    if (ACCEPTABLE_ENGLISH_TERMS.has(word)) continue;
    if (ENGLISH_WORDS_TO_AVOID_IN_NORWEGIAN[word]) {
      if (!found.includes(word)) found.push(word);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Engelsk-validering (lettvekts)
// ---------------------------------------------------------------------------

function validateEnglishContent(draft: CvDraft): AtsViolation[] {
  const violations: AtsViolation[] = [];

  // Sjekk om norske spesialtegn (æ/ø/å) finnes i engelsk-merket CV
  // (kan forekomme legitimt for navn — vi advarer kun, blokkerer ikke)
  const checkText = (text: string, fieldPath: string) => {
    if (/[æøåÆØÅ]/.test(text)) {
      // Kun advarsel hvis det er i bullet/beskrivelse, ikke i navn
      if (!fieldPath.includes("header") && !fieldPath.includes("employer") && !fieldPath.includes("institution")) {
        violations.push({
          severity: "info",
          category: "language",
          rule_id: "language.norwegian_chars_in_english_cv",
          message: "Norsk spesialtegn (æ/ø/å) i engelsk CV.",
          field_path: fieldPath,
          suggestion: "Bytt med ae/oe/aa hvis det ikke er en del av et egennavn.",
        });
      }
    }
  };

  if (draft.summary) checkText(draft.summary, "summary");
  draft.roles.forEach((role, rIdx) => {
    role.achievements.forEach((bullet, bIdx) => {
      checkText(bullet, `roles[${rIdx}].achievements[${bIdx}]`);
    });
  });

  return violations;
}
