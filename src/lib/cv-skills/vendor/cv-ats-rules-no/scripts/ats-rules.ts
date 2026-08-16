// cv-ats-rules-no — Hovedmotor
// Eneste fil edge-funksjoner og frontend trenger å importere for å bruke
// Skill-en i kjøretid.

import type {
  AtsCheckResult,
  AtsViolation,
  CvDraft,
  Language,
  SectionHeaders,
} from "./types.ts";

import { validateFormat } from "./validators/format-validator.ts";
import { validateContent } from "./validators/content-validator.ts";
import { validateLanguage } from "./validators/language-validator.ts";
import { validateGdpr } from "./validators/gdpr-validator.ts";

// ---------------------------------------------------------------------------
// Re-eksporter konstanter slik at rendering kan importere alt fra én sti
// ---------------------------------------------------------------------------

export {
  ATS_SAFE_FONTS,
  ATS_DEFAULT_FONT,
  ATS_DEFAULT_FONT_SIZE_PT,
  ATS_MIN_FONT_SIZE_PT,
  ATS_MAX_FONT_SIZE_PT,
} from "./validators/format-validator.ts";

export {
  SECTION_HEADERS_NO,
  SECTION_HEADERS_EN,
  NORWEGIAN_MONTH_ABBR,
  ENGLISH_MONTH_ABBR,
  MAX_BULLET_LENGTH,
  MAX_SUMMARY_LENGTH,
  MIN_SUMMARY_LENGTH,
  MAX_HEADLINE_LENGTH,
  MAX_BULLETS_PER_ROLE,
  getSectionHeader,
  formatYearMonth,
  formatDateRange,
} from "./validators/content-validator.ts";

export {
  ENGLISH_WORDS_TO_AVOID_IN_NORWEGIAN,
  ACCEPTABLE_ENGLISH_TERMS,
} from "./validators/language-validator.ts";

// Re-eksporter typer
export type {
  AtsCheckResult,
  AtsViolation,
  CvDraft,
  CvDraftHeader,
  CvDraftRoleEntry,
  CvDraftEducationEntry,
  CvDraftSkill,
  CvDraftLanguage,
  CvDraftCertification,
  CvDraftProject,
  CvDraftVolunteer,
  Language,
  SectionHeaders,
  ViolationCategory,
  ViolationSeverity,
  TargetKeyword,
  CandidateEvidenceTerm,
  KeywordMatch,
  AtsRelevanceResult,
} from "./types.ts";

export { evaluateKeywordCoverage } from "./keyword-coverage.ts";

// ---------------------------------------------------------------------------
// Versjonering
// ---------------------------------------------------------------------------

export const RULES_VERSION = "2.0.0";

// ---------------------------------------------------------------------------
// Hovedvalidator
// ---------------------------------------------------------------------------

/**
 * Validerer et CV-utkast mot norske ATS-regler og GDPR-regler.
 * Brukes før eksport til docx/pdf.
 *
 * @param draft - CV-utkast å validere
 * @returns Resultat med ok-flagg og kategorisering av violations
 */
export function validateCvDraft(draft: CvDraft): AtsCheckResult {
  const allViolations: AtsViolation[] = [
    ...validateFormat(draft),
    ...validateContent(draft),
    ...validateLanguage(draft),
    ...validateGdpr(draft),
  ];

  const errors = allViolations.filter((v) => v.severity === "error");
  const warnings = allViolations.filter((v) => v.severity === "warning");
  const infos = allViolations.filter((v) => v.severity === "info");

  return {
    ok: errors.length === 0,
    violations: allViolations,
    errors,
    warnings,
    infos,
    rules_version: RULES_VERSION,
  };
}

/**
 * Lettvekts-validator som kun sjekker errors. Bruk i hot paths der vi
 * vil avgjøre om eksport kan kjøre uten å samle alle warnings.
 */
export function hasBlockingErrors(draft: CvDraft): boolean {
  // Kjør validatorene én etter én og returner ved første error for å spare arbeid.
  // For enkelhetens skyld kjører vi alle her — datasettet er lite.
  const result = validateCvDraft(draft);
  return result.errors.length > 0;
}

/**
 * Genererer en menneskelig sammendragstekst av violations på norsk eller engelsk.
 * Brukes i UI for å vise resultatet.
 */
export function summarizeViolations(
  result: AtsCheckResult,
  language: Language = "no",
): string {
  if (result.ok && result.warnings.length === 0 && result.infos.length === 0) {
    return language === "no"
      ? "CV-utkastet passerer alle ATS-regler uten merknader."
      : "Draft passes all ATS rules with no remarks.";
  }

  const parts: string[] = [];

  if (result.errors.length > 0) {
    parts.push(
      language === "no"
        ? `${result.errors.length} feil må rettes før eksport`
        : `${result.errors.length} errors must be fixed before export`,
    );
  }
  if (result.warnings.length > 0) {
    parts.push(
      language === "no"
        ? `${result.warnings.length} advarsler bør vurderes`
        : `${result.warnings.length} warnings should be reviewed`,
    );
  }
  if (result.infos.length > 0) {
    parts.push(
      language === "no"
        ? `${result.infos.length} forbedringsforslag`
        : `${result.infos.length} suggestions`,
    );
  }

  return parts.join(", ") + ".";
}

// ---------------------------------------------------------------------------
// Helper for rendering — oppretter trygge defaults
// ---------------------------------------------------------------------------

/**
 * Returner en CvDraft med ATS-trygge default-verdier for font og layout.
 * Brukes som starting point i CV-builder.
 */
export function createSafeDraftDefaults(language: Language = "no"): Partial<CvDraft> {
  return {
    language,
    font_family: "Calibri",
    base_font_size_pt: 11,
  };
}

/**
 * Generer ATS-safe filnavn basert på navn og kontekst.
 *
 * Eksempler:
 *   buildSafeFilename({fullName: "Henrik Vaage", language: "no"})
 *   → "CV_Henrik_Vaage_NO.docx"
 *
 *   buildSafeFilename({fullName: "Henrik Vaage", language: "no", variant: "ECIT"})
 *   → "CV_Henrik_Vaage_ECIT.docx"
 */
export function buildSafeFilename(input: {
  fullName: string;
  language: Language;
  variant?: string;
  documentType?: "cv" | "soknad" | "referanseliste";
  extension?: "docx" | "pdf";
}): string {
  const docType = input.documentType ?? "cv";
  const ext = input.extension ?? "docx";

  // Normaliser navn — fjern æøå, mellomrom → _, fjern spesialtegn
  const safeName = input.fullName
    .replace(/æ/g, "a").replace(/Æ/g, "A")
    .replace(/ø/g, "o").replace(/Ø/g, "O")
    .replace(/å/g, "a").replace(/Å/g, "A")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "_");

  // Variant — samme normalisering
  const safeVariant = input.variant
    ? input.variant
        .replace(/æ/g, "a").replace(/Æ/g, "A")
        .replace(/ø/g, "o").replace(/Ø/g, "O")
        .replace(/å/g, "a").replace(/Å/g, "A")
        .replace(/[^a-zA-Z0-9\s]/g, "")
        .trim()
        .replace(/\s+/g, "_")
    : null;

  const prefix = docType === "cv" ? "CV" : docType === "soknad" ? "Soknad" : "Referanseliste";
  const langSuffix = !safeVariant ? `_${input.language.toUpperCase()}` : "";
  const variantSuffix = safeVariant ? `_${safeVariant}` : "";

  return `${prefix}_${safeName}${variantSuffix}${langSuffix}.${ext}`;
}
