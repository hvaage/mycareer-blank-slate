// cv-ats-rules-no — GDPR-validator
// Sjekker at CV-utkastet ikke inneholder data som ikke skal være der (særlige
// kategorier av personopplysninger, eller felt som er deaktivert som default).

import type { AtsViolation, CvDraft } from "../types.ts";

// ---------------------------------------------------------------------------
// Mønstre for forbudte data
// ---------------------------------------------------------------------------

// Norsk personnummer: 11 sifre, enten med eller uten mellomrom
const NORWEGIAN_PERSONAL_ID_RE = /\b\d{6}[\s-]?\d{5}\b/;

// Sosialnummer-mønstre (USA): XXX-XX-XXXX
const US_SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;

// Pass-nummer (norsk): bokstav + 8 sifre
const NORWEGIAN_PASSPORT_RE = /\b[A-Z]\d{8}\b/;

// Ord som tyder på særlige kategorier (helse, religion, etnisitet, sivilstand)
const SENSITIVE_KEYWORDS_NO: ReadonlyArray<{ pattern: RegExp; topic: string }> = [
  { pattern: /\b(gift|samboer|skilt|ugift|enke|enkemann|sivilstand)\b/i, topic: "sivilstand" },
  { pattern: /\b(barn|antall barn|sønn|datter|familie)\b/i, topic: "familie" },
  { pattern: /\b(kristen|muslim|jødisk|buddhist|hindu|ateist|religion|trossamfunn)\b/i, topic: "religion" },
  { pattern: /\b(diagnose|diabetes|kreft|adhd|autisme|funksjonsnedsettelse|funksjonshemming|ufør)\b/i, topic: "helse" },
  { pattern: /\b(høyre|arbeiderpartiet|venstre|frp|sv|krf|partimedlem|politisk aktiv)\b/i, topic: "politisk" },
  { pattern: /\b(fagforbund|fagforening|lo-medlem|nito-medlem|tekna-medlem)\b/i, topic: "fagforening" },
];

const SENSITIVE_KEYWORDS_EN: ReadonlyArray<{ pattern: RegExp; topic: string }> = [
  { pattern: /\b(married|single|divorced|widowed|marital status)\b/i, topic: "marital status" },
  { pattern: /\b(children|son|daughter|family status)\b/i, topic: "family" },
  { pattern: /\b(christian|muslim|jewish|buddhist|hindu|atheist|religion)\b/i, topic: "religion" },
  { pattern: /\b(diagnosis|diabetes|cancer|disability|disabled|adhd|autism)\b/i, topic: "health" },
  { pattern: /\b(republican|democrat|labor party|political party)\b/i, topic: "political" },
];

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export function validateGdpr(draft: CvDraft): AtsViolation[] {
  const violations: AtsViolation[] = [];

  // Sjekk header-felter
  violations.push(...checkHeaderFields(draft));

  // Sjekk alle tekst-felt for personnummer og særlige kategorier
  const textFields = collectTextFields(draft);
  for (const { text, path } of textFields) {
    violations.push(...checkSensitivePatterns(text, path, draft.language));
  }

  return violations;
}

function checkHeaderFields(draft: CvDraft): AtsViolation[] {
  const violations: AtsViolation[] = [];
  const h = draft.header;
  const currentYear = new Date().getFullYear();

  // Fødselsår uten samtykke (default skal være null)
  // Vi kan ikke vite om brukeren har samtykket via dette laget; vi advarer kun
  // hvis fødselsår er satt OG kandidaten er ung nok at det kan virke
  // diskriminerende. Antar samtykke håndteres av brukerflyt.
  if (h.birth_year != null) {
    const age = currentYear - h.birth_year;
    if (age < 25 || age > 60) {
      violations.push({
        severity: "info",
        category: "gdpr",
        rule_id: "gdpr.birth_year_age_bias",
        message: `Fødselsår er inkludert (alder ${age}). Vurder om dette er ønskelig — det kan påvirke screening-bias.`,
        field_path: "header.birth_year",
        suggestion: "Fjern fødselsår med mindre du har spesifikk grunn til å inkludere det.",
      });
    }
  }

  return violations;
}

function checkSensitivePatterns(
  text: string,
  fieldPath: string,
  language: string,
): AtsViolation[] {
  const violations: AtsViolation[] = [];

  // Personnummer — alltid error
  if (NORWEGIAN_PERSONAL_ID_RE.test(text)) {
    violations.push({
      severity: "error",
      category: "gdpr",
      rule_id: "gdpr.norwegian_personal_id",
      message: "Inneholder det som ser ut som norsk personnummer/fødselsnummer.",
      field_path: fieldPath,
      suggestion: "Fjern umiddelbart. Personnummer skal aldri stå i CV.",
    });
  }

  if (US_SSN_RE.test(text)) {
    violations.push({
      severity: "error",
      category: "gdpr",
      rule_id: "gdpr.us_ssn",
      message: "Inneholder det som ser ut som US Social Security Number.",
      field_path: fieldPath,
      suggestion: "Fjern umiddelbart.",
    });
  }

  if (NORWEGIAN_PASSPORT_RE.test(text)) {
    violations.push({
      severity: "warning",
      category: "gdpr",
      rule_id: "gdpr.passport_number",
      message: "Inneholder det som kan være pass-nummer.",
      field_path: fieldPath,
      suggestion: "Fjern hvis dette er pass-nummer.",
    });
  }

  // Særlige kategorier
  const keywordList = language === "no" ? SENSITIVE_KEYWORDS_NO : SENSITIVE_KEYWORDS_EN;
  for (const { pattern, topic } of keywordList) {
    if (pattern.test(text)) {
      violations.push({
        severity: "warning",
        category: "gdpr",
        rule_id: `gdpr.sensitive_${topic}`,
        message: `Inneholder ord som indikerer ${topic} — særlig kategori av personopplysninger.`,
        field_path: fieldPath,
        suggestion: "Vurder om dette er nødvendig for stillingen. Default er å utelate.",
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

interface TextFieldEntry {
  text: string;
  path: string;
}

function collectTextFields(draft: CvDraft): TextFieldEntry[] {
  const fields: TextFieldEntry[] = [];

  if (draft.summary) fields.push({ text: draft.summary, path: "summary" });

  if (draft.header.headline) {
    fields.push({ text: draft.header.headline, path: "header.headline" });
  }

  draft.roles.forEach((role, idx) => {
    if (role.description) {
      fields.push({ text: role.description, path: `roles[${idx}].description` });
    }
    role.achievements.forEach((b, bIdx) => {
      fields.push({ text: b, path: `roles[${idx}].achievements[${bIdx}]` });
    });
  });

  draft.educations.forEach((edu, idx) => {
    if (edu.thesis) {
      fields.push({ text: edu.thesis, path: `educations[${idx}].thesis` });
    }
    if (edu.honors) {
      fields.push({ text: edu.honors, path: `educations[${idx}].honors` });
    }
  });

  draft.projects.forEach((p, idx) => {
    fields.push({ text: p.description, path: `projects[${idx}].description` });
  });

  draft.volunteer.forEach((v, idx) => {
    if (v.description) {
      fields.push({ text: v.description, path: `volunteer[${idx}].description` });
    }
  });

  return fields;
}
