// cv-evidence-graph — Validators
// Valideringsregler for atoms før de skrives til databasen.
// Kjøres i Edge-funksjon eller frontend før Supabase-insert/update.

import type {
  AtomBase,
  AtomInsert,
  AtomType,
  RoleStructuredData,
  AchievementStructuredData,
  MetricStructuredData,
  EducationStructuredData,
  SkillStructuredData,
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
  if (!nonEmpty(data.category)) return fail("skill.category er påkrevd");
  if (data.years_used != null && data.years_used < 0) {
    return fail("skill.years_used kan ikke være negativ");
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
// Validate full atom
// ---------------------------------------------------------------------------

export function validateAtom(atom: AtomInsert | AtomBase): ValidationResult {
  // Felles felter
  if (!nonEmpty(atom.user_id)) return fail("atom.user_id er påkrevd");
  if (!atom.atom_type) return fail("atom.atom_type er påkrevd");

  // Innhold — enten content_no, content_en eller structured_data må være satt
  const hasContent =
    nonEmpty(atom.content_no) ||
    nonEmpty(atom.content_en) ||
    (atom.structured_data && Object.keys(atom.structured_data).length > 0);
  if (!hasContent) {
    return fail("atom må ha content_no, content_en eller structured_data");
  }

  // Lengdebegrensning
  const MAX_CONTENT_LENGTH = 2000;
  if (atom.content_no && atom.content_no.length > MAX_CONTENT_LENGTH) {
    return fail(`content_no er for lang (>${MAX_CONTENT_LENGTH} tegn)`);
  }
  if (atom.content_en && atom.content_en.length > MAX_CONTENT_LENGTH) {
    return fail(`content_en er for lang (>${MAX_CONTENT_LENGTH} tegn)`);
  }

  // Hierarki-regler
  const requiresParent: AtomType[] = ["achievement", "metric"];
  if (requiresParent.includes(atom.atom_type) && !nonEmpty(atom.parent_atom_id)) {
    return fail(`${atom.atom_type} krever parent_atom_id`);
  }

  const noParent: AtomType[] = ["language", "summary_fragment"];
  if (noParent.includes(atom.atom_type) && atom.parent_atom_id != null) {
    return fail(`${atom.atom_type} skal ikke ha parent_atom_id`);
  }

  // Per-type structured_data-validering
  const sd = atom.structured_data;
  switch (atom.atom_type) {
    case "role":
      return mergeWarnings(
        validateRoleStructuredData(sd as Partial<RoleStructuredData>),
      );
    case "achievement":
      return mergeWarnings(
        validateAchievementStructuredData(sd as Partial<AchievementStructuredData>),
      );
    case "metric":
      return mergeWarnings(
        validateMetricStructuredData(sd as Partial<MetricStructuredData>),
      );
    case "education":
      return mergeWarnings(
        validateEducationStructuredData(sd as Partial<EducationStructuredData>),
      );
    case "skill":
      return mergeWarnings(
        validateSkillStructuredData(sd as Partial<SkillStructuredData>),
      );
    case "language":
      return mergeWarnings(
        validateLanguageStructuredData(sd as Partial<LanguageStructuredData>),
      );
    case "certification":
      return mergeWarnings(
        validateCertificationStructuredData(sd as Partial<CertificationStructuredData>),
      );
    case "project":
      return mergeWarnings(
        validateProjectStructuredData(sd as Partial<ProjectStructuredData>),
      );
    case "volunteer":
      return mergeWarnings(
        validateVolunteerStructuredData(sd as Partial<VolunteerStructuredData>),
      );
    case "context":
    case "tool":
    case "summary_fragment":
      // Disse har enklere regler — krever bare at structured_data har innhold
      if (!sd || Object.keys(sd).length === 0) {
        return fail(`${atom.atom_type} krever structured_data`);
      }
      return ok;
    default:
      return fail(`Ukjent atom_type: ${(atom as { atom_type: string }).atom_type}`);
  }
}

function mergeWarnings(r: ValidationResult): ValidationResult {
  return r;
}

// ---------------------------------------------------------------------------
// Batch-validation — for bruk under import
// ---------------------------------------------------------------------------

export interface BatchValidationResult {
  valid: AtomInsert[];
  invalid: { atom: AtomInsert; error: string }[];
}

export function validateBatch(atoms: AtomInsert[]): BatchValidationResult {
  const valid: AtomInsert[] = [];
  const invalid: { atom: AtomInsert; error: string }[] = [];
  for (const atom of atoms) {
    const result = validateAtom(atom);
    if (result.ok) {
      valid.push(atom);
    } else {
      invalid.push({ atom, error: result.error ?? "ukjent feil" });
    }
  }
  return { valid, invalid };
}
