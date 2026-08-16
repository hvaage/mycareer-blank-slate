// cv-ats-rules-no — Content-validator
// Sjekker innholds-relaterte regler: påkrevde seksjoner, lengder, datoformat

import type { AtsViolation, CvDraft, Language } from "../types.ts";

// ---------------------------------------------------------------------------
// Konstanter
// ---------------------------------------------------------------------------

export const SECTION_HEADERS_NO: Readonly<Record<string, string>> = {
  summary: "Profilsammendrag",
  experience: "Erfaring",
  education: "Utdanning",
  skills: "Ferdigheter",
  languages: "Språk",
  certifications: "Sertifiseringer",
  projects: "Prosjekter",
  volunteer: "Frivillig arbeid",
} as const;

export const SECTION_HEADERS_EN: Readonly<Record<string, string>> = {
  summary: "Summary",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  languages: "Languages",
  certifications: "Certifications",
  projects: "Projects",
  volunteer: "Volunteer Experience",
} as const;

export const NORWEGIAN_MONTH_ABBR: Readonly<Record<string, string>> = {
  "01": "jan.",
  "02": "feb.",
  "03": "mar.",
  "04": "apr.",
  "05": "mai",
  "06": "jun.",
  "07": "jul.",
  "08": "aug.",
  "09": "sep.",
  "10": "okt.",
  "11": "nov.",
  "12": "des.",
} as const;

export const ENGLISH_MONTH_ABBR: Readonly<Record<string, string>> = {
  "01": "Jan",
  "02": "Feb",
  "03": "Mar",
  "04": "Apr",
  "05": "May",
  "06": "Jun",
  "07": "Jul",
  "08": "Aug",
  "09": "Sep",
  "10": "Oct",
  "11": "Nov",
  "12": "Dec",
} as const;

export const MAX_BULLET_LENGTH = 240;        // ~ 2 linjer
export const MAX_SUMMARY_LENGTH = 700;       // ~ 100 ord
export const MIN_SUMMARY_LENGTH = 80;        // unngå "intetsigende" sammendrag
export const MAX_HEADLINE_LENGTH = 100;
export const MAX_BULLETS_PER_ROLE = 8;       // mer enn dette = signal-tap
export const MIN_BULLETS_PER_ROLE_RECENT = 2; // for nyere roller

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export function validateContent(draft: CvDraft): AtsViolation[] {
  const violations: AtsViolation[] = [];

  // Header-validering
  violations.push(...validateHeader(draft));

  // Påkrevde seksjoner
  violations.push(...validateRequiredSections(draft));

  // Profilsammendrag
  if (draft.summary) {
    violations.push(...validateSummary(draft.summary));
  }

  // Roles
  draft.roles.forEach((role, idx) => {
    violations.push(...validateRole(role, idx));
  });

  // Educations
  draft.educations.forEach((edu, idx) => {
    violations.push(...validateEducation(edu, idx));
  });

  return violations;
}

function validateHeader(draft: CvDraft): AtsViolation[] {
  const violations: AtsViolation[] = [];
  const h = draft.header;

  if (!h.full_name || h.full_name.trim().length === 0) {
    violations.push({
      severity: "error",
      category: "content",
      rule_id: "content.missing_name",
      message: "Navn er påkrevd i toppen av CV-en.",
      field_path: "header.full_name",
      suggestion: "Legg inn fullt navn.",
    });
  }

  if (!h.email || !isValidEmail(h.email)) {
    violations.push({
      severity: "error",
      category: "content",
      rule_id: "content.missing_email",
      message: "Gyldig e-postadresse er påkrevd.",
      field_path: "header.email",
      suggestion: "Legg inn en profesjonell e-postadresse.",
    });
  }

  if (h.headline && h.headline.length > MAX_HEADLINE_LENGTH) {
    violations.push({
      severity: "warning",
      category: "content",
      rule_id: "content.headline_too_long",
      message: `Headline er ${h.headline.length} tegn — over anbefalt maksimum på ${MAX_HEADLINE_LENGTH}.`,
      field_path: "header.headline",
      suggestion: "Forkort til 60–80 tegn for best lesbarhet.",
    });
  }

  if (h.phone && !isValidNorwegianPhone(h.phone) && !isValidInternationalPhone(h.phone)) {
    violations.push({
      severity: "warning",
      category: "content",
      rule_id: "content.phone_format",
      message: `Telefonnummeret "${h.phone}" har et uvanlig format.`,
      field_path: "header.phone",
      suggestion: "Bruk format +47 XXX XX XXX eller internasjonalt med landskode.",
    });
  }

  return violations;
}

function validateRequiredSections(draft: CvDraft): AtsViolation[] {
  const violations: AtsViolation[] = [];

  if (draft.roles.length === 0) {
    violations.push({
      severity: "error",
      category: "content",
      rule_id: "content.no_experience",
      message: "Erfaring-seksjonen er tom. CV-en må ha minst én rolle.",
      field_path: "roles",
      suggestion: "Legg til arbeidserfaring eller vurder om en CV er riktig dokument-type.",
    });
  }

  if (draft.educations.length === 0) {
    violations.push({
      severity: "warning",
      category: "content",
      rule_id: "content.no_education",
      message: "Utdanning-seksjonen er tom. De fleste CV-er bør ha minst én utdannelse.",
      field_path: "educations",
      suggestion: "Legg til relevant utdanning, eller bekreft at det er bevisst utelatt.",
    });
  }

  if (!draft.summary) {
    violations.push({
      severity: "info",
      category: "content",
      rule_id: "content.no_summary",
      message: "Profilsammendrag mangler.",
      field_path: "summary",
      suggestion: "Vurder å legge til et 3–5 setninger sammendrag øverst — det er førsteinntrykket.",
    });
  }

  return violations;
}

function validateSummary(summary: string): AtsViolation[] {
  const violations: AtsViolation[] = [];

  if (summary.length < MIN_SUMMARY_LENGTH) {
    violations.push({
      severity: "warning",
      category: "content",
      rule_id: "content.summary_too_short",
      message: `Profilsammendrag er kort (${summary.length} tegn).`,
      field_path: "summary",
      suggestion: `Skriv 3–5 setninger som dekker rolle, erfaring og styrke.`,
    });
  } else if (summary.length > MAX_SUMMARY_LENGTH) {
    violations.push({
      severity: "warning",
      category: "content",
      rule_id: "content.summary_too_long",
      message: `Profilsammendrag er ${summary.length} tegn — over anbefalt maks ${MAX_SUMMARY_LENGTH}.`,
      field_path: "summary",
      suggestion: "Komprimer til de mest sentrale punktene. 60–100 ord er optimum.",
    });
  }

  return violations;
}

function validateRole(role: CvDraft["roles"][0], idx: number): AtsViolation[] {
  const violations: AtsViolation[] = [];
  const path = `roles[${idx}]`;

  if (!isValidYearMonth(role.start_date)) {
    violations.push({
      severity: "error",
      category: "content",
      rule_id: "content.role_date_format",
      message: `Startdato "${role.start_date}" må være i format YYYY-MM.`,
      field_path: `${path}.start_date`,
      suggestion: "Eksempel: 2019-01.",
    });
  }

  if (role.end_date != null && !isValidYearMonth(role.end_date)) {
    violations.push({
      severity: "error",
      category: "content",
      rule_id: "content.role_date_format",
      message: `Sluttdato "${role.end_date}" må være i format YYYY-MM eller null.`,
      field_path: `${path}.end_date`,
      suggestion: "Eksempel: 2024-06, eller la stå tomt for pågående.",
    });
  }

  if (role.is_current && role.end_date != null) {
    violations.push({
      severity: "warning",
      category: "content",
      rule_id: "content.role_current_with_end",
      message: "Rollen er markert som pågående, men har sluttdato.",
      field_path: `${path}.end_date`,
      suggestion: "Fjern sluttdato hvis pågående, eller fjern is_current-flagget.",
    });
  }

  if (role.achievements.length > MAX_BULLETS_PER_ROLE) {
    violations.push({
      severity: "warning",
      category: "content",
      rule_id: "content.too_many_bullets",
      message: `${role.achievements.length} bullets — over anbefalt maks ${MAX_BULLETS_PER_ROLE}.`,
      field_path: `${path}.achievements`,
      suggestion: "Velg de 3–6 mest relevante. Mer signal, mindre støy.",
    });
  }

  role.achievements.forEach((bullet, bIdx) => {
    if (bullet.length > MAX_BULLET_LENGTH) {
      violations.push({
        severity: "warning",
        category: "content",
        rule_id: "content.bullet_too_long",
        message: `Bullet ${bIdx + 1} er ${bullet.length} tegn — for lang.`,
        field_path: `${path}.achievements[${bIdx}]`,
        suggestion: `Forkort til maks ${MAX_BULLET_LENGTH} tegn (~2 linjer).`,
      });
    }
    if (containsForbiddenSymbols(bullet)) {
      violations.push({
        severity: "error",
        category: "content",
        rule_id: "content.bullet_forbidden_symbol",
        message: `Bullet ${bIdx + 1} inneholder symboler eller emoji som kan ødelegge ATS-parsing.`,
        field_path: `${path}.achievements[${bIdx}]`,
        suggestion: "Fjern emoji og symbol-ikoner. Bruk vanlige tekst-tegn.",
      });
    }
  });

  return violations;
}

function validateEducation(
  edu: CvDraft["educations"][0],
  idx: number,
): AtsViolation[] {
  const violations: AtsViolation[] = [];
  const path = `educations[${idx}]`;

  const currentYear = new Date().getFullYear();

  if (!Number.isInteger(edu.start_year) || edu.start_year < 1900 || edu.start_year > currentYear + 1) {
    violations.push({
      severity: "error",
      category: "content",
      rule_id: "content.education_year",
      message: `Startår ${edu.start_year} er ugyldig.`,
      field_path: `${path}.start_year`,
      suggestion: `Bruk firesifret år mellom 1900 og ${currentYear + 1}.`,
    });
  }

  if (edu.end_year != null && edu.end_year < edu.start_year) {
    violations.push({
      severity: "error",
      category: "content",
      rule_id: "content.education_year_order",
      message: "Sluttår er før startår.",
      field_path: `${path}.end_year`,
      suggestion: "Korriger sluttår.",
    });
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Hjelpefunksjoner
// ---------------------------------------------------------------------------

function isValidYearMonth(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function isValidNorwegianPhone(s: string): boolean {
  // +47 fulgt av 8 sifre, med eventuelle mellomrom
  const cleaned = s.replace(/\s+/g, "");
  return /^\+47\d{8}$/.test(cleaned);
}

function isValidInternationalPhone(s: string): boolean {
  // + fulgt av landskode og minst 7 sifre
  const cleaned = s.replace(/\s+/g, "");
  return /^\+\d{7,15}$/.test(cleaned);
}

function containsForbiddenSymbols(s: string): boolean {
  // Emoji, symbol-ikoner, mathematical symbols
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]/u;
  return emojiRegex.test(s);
}

// ---------------------------------------------------------------------------
// Section header lookup
// ---------------------------------------------------------------------------

export function getSectionHeader(section: string, language: Language): string {
  const map = language === "no" ? SECTION_HEADERS_NO : SECTION_HEADERS_EN;
  return map[section] ?? section;
}

export function formatYearMonth(yyyymm: string, language: Language): string {
  const [year, month] = yyyymm.split("-");
  if (!year || !month) return yyyymm;
  const monthMap = language === "no" ? NORWEGIAN_MONTH_ABBR : ENGLISH_MONTH_ABBR;
  const monthAbbr = monthMap[month] ?? month;
  return `${monthAbbr} ${year}`;
}

export function formatDateRange(
  start: string,
  end: string | null,
  isCurrent: boolean,
  language: Language,
): string {
  const startFmt = formatYearMonth(start, language);
  const endFmt = isCurrent || end == null
    ? language === "no" ? "nå" : "present"
    : formatYearMonth(end, language);
  return `${startFmt} – ${endFmt}`;
}
