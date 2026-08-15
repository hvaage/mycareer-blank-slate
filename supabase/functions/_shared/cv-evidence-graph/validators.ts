// cv-evidence-graph — Validators
// Skjema-versjon: 4.0 (parselaget)
//
// Valideringsregler for parsekandidater før de skrives til cv_parse_candidates.
// Hierarkiet valideres på local_ref/parent_local_ref, ikke på atom-IDer.

import type {
  CandidateDraft,
  CandidateInsert,
  AtomType,
  RoleStructuredData,
  AchievementStructuredData,
  MetricStructuredData,
  EducationStructuredData,
  SkillStructuredData,
  DomainStructuredData,
  ToolStructuredData,
  LanguageStructuredData,
  CertificationStructuredData,
  ProjectStructuredData,
  VolunteerStructuredData,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean;
  error?: string;
  warnings?: string[];
}

const ok: ValidationResult = { ok: true };
const fail = (error: string): ValidationResult => ({ ok: false, error });

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

const YEAR_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR_RE = /^\d{4}$/;

function isYearMonth(s: string | null | undefined): boolean {
  return typeof s === "string" && YEAR_MONTH_RE.test(s);
}

function compareYearMonth(a: string, b: string): number {
  // returns -1 if a < b, 0 if equal, 1 if a > b
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function todayYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nonEmpty(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Per-type validators
// ---------------------------------------------------------------------------

export function validateRoleStructuredData(
  data: Partial<RoleStructuredData>,
): ValidationResult {
  if (!nonEmpty(data.employer)) return fail("role.employer er påkrevd");
  if (!nonEmpty(data.title)) return fail("role.title er påkrevd");
  if (!isYearMonth(data.start_date ?? null)) {
    return fail("role.start_date må være YYYY-MM");
  }
  if (data.end_date != null && !isYearMonth(data.end_date)) {
    return fail("role.end_date må være YYYY-MM eller null");
  }
  if (data.end_date && data.start_date) {
    if (compareYearMonth(data.start_date, data.end_date) > 0) {
      return fail("role.end_date kan ikke være før start_date");
    }
  }
  if (data.start_date && compareYearMonth(data.start_date, todayYearMonth()) > 0) {
    return fail("role.start_date kan ikke være i fremtiden");
  }
  if (data.is_current === true && data.end_date != null) {
    return {
      ok: true,
      warnings: ["role.is_current=true men end_date er satt; ignorerer end_date"],
    };
  }

  return ok;
}

export function validateAchievementStructuredData(
  data: Partial<AchievementStructuredData>,
): ValidationResult {
  if (!nonEmpty(data.what)) return fail("achievement.what er påkrevd");

  const hasXyz =
    nonEmpty(data.what) &&
    (nonEmpty(data.how_measured) || nonEmpty(data.how_done));
  const hasCar =
    nonEmpty(data.challenge) &&
    nonEmpty(data.action) &&
    nonEmpty(data.result);

  if (!hasXyz && !hasCar) {
    return {
      ok: true,
      warnings: [
        "achievement har bare 'what' uten how_measured/how_done eller CAR-trippel — vurder å berike",
      ],
    };
  }

  if (data.scope_team_size != null && data.scope_team_size < 0) {
    return fail("achievement.scope_team_size kan ikke være negativ");
  }

  return ok;
}

export function validateMetricStructuredData(
  data: Partial<MetricStructuredData>,
): ValidationResult {
  if (typeof data.value !== "number" || !Number.isFinite(data.value)) {
    return fail("metric.value må være et tall");
  }
  if (!nonEmpty(data.unit)) return fail("metric.unit er påkrevd");
  if (!nonEmpty(data.metric_type)) return fail("metric.metric_type er påkrevd");
  return ok;
}

export function validateEducationStructuredData(
  data: Partial<EducationStructuredData>,
): ValidationResult {
  if (!nonEmpty(data.institution)) return fail("education.institution er påkrevd");
  if (!nonEmpty(data.degree)) return fail("education.degree er påkrevd");
  if (typeof data.start_year !== "number" || !YEAR_RE.test(String(data.start_year))) {
    return fail("education.start_year må være firesifret år");
  }
  if (data.end_year != null) {
    if (typeof data.end_year !== "number" || !YEAR_RE.test(String(data.end_year))) {
      return fail("education.end_year må være firesifret år eller null");
    }
    if (data.end_year < data.start_year) {
      return fail("education.end_year kan ikke være før start_year");
    }
  }
  const currentYear = new Date().getFullYear();
  if (data.start_year > currentYear + 1) {
    return fail("education.start_year er for langt i fremtiden");
  }
  return ok;
}

export function validateSkillStructuredData(
  data: Partial<SkillStructuredData>,
): ValidationResult {
  if (!nonEmpty(data.name)) return fail("skill.name er påkrevd");
  if (!nonEmpty(data.source_category)) {
    return fail("skill.source_category er påkrevd (parserens grovkategori)");
  }
  if (data.years_used != null && data.years_used < 0) {
    return fail("skill.years_used kan ikke være negativ");
  }
  return ok;
}

export function validateDomainStructuredData(
  data: Partial<DomainStructuredData>,
): ValidationResult {
  if (!nonEmpty(data.name)) return fail("domain.name er påkrevd");
  if (data.years_exposed != null && data.years_exposed < 0) {
    return fail("domain.years_exposed kan ikke være negativ");
  }
  return ok;
}

export function validateToolStructuredData(
  data: Partial<ToolStructuredData>,
): ValidationResult {
  if (!nonEmpty(data.name)) return fail("tool.name er påkrevd");
  if (data.years_used != null && data.years_used < 0) {
    return fail("tool.years_used kan ikke være negativ");
  }
  return ok;
}

export function validateLanguageStructuredData(
  data: Partial<LanguageStructuredData>,
): ValidationResult {
  if (!nonEmpty(data.language)) return fail("language.language er påkrevd");
  if (!nonEmpty(data.level)) return fail("language.level er påkrevd");
  const validLevels = ["native", "fluent", "professional", "conversational", "basic"];
  if (!validLevels.includes(data.level as string)) {
    return fail(`language.level må være en av: ${validLevels.join(", ")}`);
  }
  return ok;
}

export function validateCertificationStructuredData(
  data: Partial<CertificationStructuredData>,
): ValidationResult {
  if (!nonEmpty(data.name)) return fail("certification.name er påkrevd");
  if (!nonEmpty(data.issuer)) return fail("certification.issuer er påkrevd");
  if (data.issued_date != null && !isYearMonth(data.issued_date)) {
    return fail("certification.issued_date må være YYYY-MM eller null");
  }
  if (data.expires_date != null && !isYearMonth(data.expires_date)) {
    return fail("certification.expires_date må være YYYY-MM eller null");
  }
  return ok;
}

export function validateProjectStructuredData(
  data: Partial<ProjectStructuredData>,
): ValidationResult {
  if (!nonEmpty(data.name)) return fail("project.name er påkrevd");
  if (!nonEmpty(data.description)) return fail("project.description er påkrevd");
  if (data.start_date != null && !isYearMonth(data.start_date)) {
    return fail("project.start_date må være YYYY-MM eller null");
  }
  if (data.end_date != null && !isYearMonth(data.end_date)) {
    return fail("project.end_date må være YYYY-MM eller null");
  }
  return ok;
}

export function validateVolunteerStructuredData(
  data: Partial<VolunteerStructuredData>,
): ValidationResult {
  if (!nonEmpty(data.organization)) return fail("volunteer.organization er påkrevd");
  if (!nonEmpty(data.role)) return fail("volunteer.role er påkrevd");
  if (!isYearMonth(data.start_date ?? null)) {
    return fail("volunteer.start_date må være YYYY-MM");
  }
  if (data.end_date != null && !isYearMonth(data.end_date)) {
    return fail("volunteer.end_date må være YYYY-MM eller null");
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Validate full kandidat
// ---------------------------------------------------------------------------

type ValidatableCandidate = CandidateDraft | CandidateInsert;

/** Typer som må henge under en rolle-kandidat i parselaget. */
const REQUIRES_PARENT: AtomType[] = ["achievement", "metric", "context"];
/** Typer som aldri kan ha forelder i parselaget. */
const FORBIDS_PARENT: AtomType[] = ["language", "summary_fragment", "education"];

export function validateCandidate(
  candidate: ValidatableCandidate,
): ValidationResult {
  if (!nonEmpty(candidate.local_ref)) return fail("kandidat.local_ref er påkrevd");
  if (!candidate.suggested_atom_type) {
    return fail("kandidat.suggested_atom_type er påkrevd");
  }
  if ("user_id" in candidate && !nonEmpty(candidate.user_id)) {
    return fail("kandidat.user_id er påkrevd");
  }
  if ("import_id" in candidate && !nonEmpty(candidate.import_id)) {
    return fail("kandidat.import_id er påkrevd");
  }
  if (candidate.parent_local_ref === candidate.local_ref) {
    return fail("kandidat.parent_local_ref kan ikke peke på seg selv");
  }
  if (
    candidate.parse_confidence != null &&
    (candidate.parse_confidence < 0 || candidate.parse_confidence > 1)
  ) {
    return fail("kandidat.parse_confidence må være mellom 0 og 1");
  }

  const hasContent =
    nonEmpty(candidate.content_no) ||
    nonEmpty(candidate.content_en) ||
    (candidate.structured_data &&
      Object.keys(candidate.structured_data).length > 0);
  if (!hasContent) {
    return fail("kandidat må ha content_no, content_en eller structured_data");
  }

  const MAX_CONTENT_LENGTH = 2000;
  if (candidate.content_no && candidate.content_no.length > MAX_CONTENT_LENGTH) {
    return fail(`content_no er for lang (>${MAX_CONTENT_LENGTH} tegn)`);
  }
  if (candidate.content_en && candidate.content_en.length > MAX_CONTENT_LENGTH) {
    return fail(`content_en er for lang (>${MAX_CONTENT_LENGTH} tegn)`);
  }

  const type = candidate.suggested_atom_type;
  if (REQUIRES_PARENT.includes(type) && !nonEmpty(candidate.parent_local_ref)) {
    return fail(`${type} krever parent_local_ref`);
  }
  if (FORBIDS_PARENT.includes(type) && candidate.parent_local_ref != null) {
    return fail(`${type} skal ikke ha parent_local_ref`);
  }

  const sd = candidate.structured_data;
  switch (type) {
    case "role":
      return validateRoleStructuredData(sd as Partial<RoleStructuredData>);
    case "achievement":
      return validateAchievementStructuredData(
        sd as Partial<AchievementStructuredData>,
      );
    case "metric":
      return validateMetricStructuredData(sd as Partial<MetricStructuredData>);
    case "education":
      return validateEducationStructuredData(sd as Partial<EducationStructuredData>);
    case "skill":
      return validateSkillStructuredData(sd as Partial<SkillStructuredData>);
    case "domain":
      return validateDomainStructuredData(sd as Partial<DomainStructuredData>);
    case "tool":
      return validateToolStructuredData(sd as Partial<ToolStructuredData>);
    case "language":
      return validateLanguageStructuredData(sd as Partial<LanguageStructuredData>);
    case "certification":
      return validateCertificationStructuredData(
        sd as Partial<CertificationStructuredData>,
      );
    case "project":
      return validateProjectStructuredData(sd as Partial<ProjectStructuredData>);
    case "volunteer":
      return validateVolunteerStructuredData(sd as Partial<VolunteerStructuredData>);
    case "context":
    case "summary_fragment":
      if (!sd || Object.keys(sd).length === 0) {
        return fail(`${type} krever structured_data`);
      }
      return ok;
    default:
      return fail(`Ukjent atom_type: ${String(type)}`);
  }
}

/**
 * Sjekk at hele importen henger sammen: hver parent_local_ref må finnes i
 * settet, og pekeren må gå til en rolle. Referanser som ikke går opp er en
 * feil som skal rapporteres, ikke droppes stille.
 */
export function validateCandidateGraph(
  candidates: ValidatableCandidate[],
): ValidationResult {
  const byRef = new Map<string, ValidatableCandidate>();
  for (const c of candidates) {
    if (byRef.has(c.local_ref)) {
      return fail(`duplikat local_ref i importen: ${c.local_ref}`);
    }
    byRef.set(c.local_ref, c);
  }
  for (const c of candidates) {
    if (c.parent_local_ref == null) continue;
    const parent = byRef.get(c.parent_local_ref);
    if (!parent) {
      return fail(
        `${c.local_ref} peker på ukjent parent_local_ref: ${c.parent_local_ref}`,
      );
    }
    if (parent.suggested_atom_type !== "role") {
      return fail(
        `${c.local_ref} peker på ${parent.local_ref} som ikke er en rolle`,
      );
    }
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Batch-validation — for bruk under import
// ---------------------------------------------------------------------------

export interface BatchValidationResult<T extends ValidatableCandidate> {
  valid: T[];
  invalid: { candidate: T; error: string }[];
}

export function validateBatch<T extends ValidatableCandidate>(
  candidates: T[],
): BatchValidationResult<T> {
  const valid: T[] = [];
  const invalid: { candidate: T; error: string }[] = [];
  for (const candidate of candidates) {
    const result = validateCandidate(candidate);
    if (result.ok) {
      valid.push(candidate);
    } else {
      invalid.push({ candidate, error: result.error ?? "ukjent feil" });
    }
  }
  return { valid, invalid };
}
