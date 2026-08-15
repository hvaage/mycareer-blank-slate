// cv-evidence-graph — TypeScript types
// Skjema-versjon: 4.0 (karriereontologi v4, fase 2.3)
//
// VIKTIG: Denne filen er en kopi av Claude-skillen `cv-evidence-graph`.
// Se docs/delt-kode-cv-evidence-graph.md. Endring her krever samme endring
// i skillen, i samme leveranse.
//
// Modulen beskriver PARSELAGET, ikke evidenslaget. Radene den produserer
// havner i `public.cv_parse_candidates` og er maskinlesning som venter på
// brukerens avgjørelse. Evidens finnes kun i `public.career_atoms`, og
// oppstår først når brukeren har bekreftet en kandidat i gjennomgangen.
//
// Derfor finnes ikke lenger her: `confidence` (v4s opprinnelsesakse),
// `attestation`, `user_confirmed`, `user_locked`, `parent_atom_id` og
// `evidence_atom_ids`. De hører til career_atoms.

// ---------------------------------------------------------------------------
// Felles enums
// ---------------------------------------------------------------------------

/** v4-vokabularet for evidens. `domain` er ny i 4.0 og er eksponering, ikke kompetanse. */
export type AtomType =
  | "role"
  | "achievement"
  | "metric"
  | "context"
  | "tool"
  | "education"
  | "skill"
  | "domain"
  | "language"
  | "certification"
  | "project"
  | "volunteer"
  | "summary_fragment";

export const ATOM_TYPES: AtomType[] = [
  "role",
  "achievement",
  "metric",
  "context",
  "tool",
  "education",
  "skill",
  "domain",
  "language",
  "certification",
  "project",
  "volunteer",
  "summary_fragment",
];

export type SourceType =
  | "linkedin_oauth"
  | "linkedin_zip"
  | "linkedin_pdf"
  | "old_cv_pdf"
  | "old_cv_docx"
  | "interview"
  | "manual"
  | "about_me_profile"
  | "onboarding";

/** Behandlingstilstand for en kandidat i gjennomgangen. */
export type CandidateStatus =
  | "ubehandlet"
  | "bekreftet"
  | "avvist"
  | "ble_sporsmal";

// ---------------------------------------------------------------------------
// Parserens grovkategori → forslag til atom_type
//
// De åtte verdiene blander tre akser: hva slags ferdighet (technical/soft),
// hvilket instrument (tool), og hvilket felt (domain). Kartet under er et
// FORSLAG. Gjennomgangen lar brukeren korrigere, og korrigeringsraten per
// kategori er det som avgjør om kartet skal endres.
// ---------------------------------------------------------------------------

export type ParserSkillCategory =
  | "technical"
  | "leadership"
  | "language"
  | "tool"
  | "methodology"
  | "domain"
  | "soft"
  | "other";

export const PARSER_SKILL_CATEGORIES: ParserSkillCategory[] = [
  "technical",
  "leadership",
  "language",
  "tool",
  "methodology",
  "domain",
  "soft",
  "other",
];

/**
 * Forslag til atom_type ut fra parserens grovkategori.
 * `null` betyr at parseren ikke kan gjette — det blir et spørsmål til brukeren.
 *
 * `leadership` foreslås som skill, men er ofte egentlig et rolleforhold.
 * Gjennomgangen skal vise personalansvar fra rollen der det finnes.
 */
export function suggestAtomTypeFromCategory(
  category: ParserSkillCategory | null | undefined,
): AtomType | null {
  switch (category) {
    case "technical":
    case "soft":
    case "methodology":
    case "leadership":
      return "skill";
    case "tool":
      return "tool";
    case "language":
      return "language";
    case "domain":
      return "domain";
    case "other":
    default:
      return null;
  }
}

/** Krever kandidaten et valg av rolle før den kan bli et atom? */
export function requiresRoleParent(atomType: AtomType): boolean {
  return atomType === "domain";
}

/** Krever kandidaten minst én evidenspeker for å kunne bli verifisert? */
export function requiresEvidencePointer(atomType: AtomType): boolean {
  return atomType === "skill";
}

// ---------------------------------------------------------------------------
// Base — felles felter for alle kandidater
// Generic S = structured_data shape; spesifiseres per atom-type nedenfor.
// ---------------------------------------------------------------------------

export interface CandidateBase<S = unknown> {
  id: string;
  user_id: string;
  import_id: string;
  /** Parserens egen id innenfor importen. Struktur uten atomgraf. */
  local_ref: string;
  parent_local_ref: string | null;
  suggested_atom_type: AtomType;
  resolved_atom_type: AtomType | null;
  suggested_from_category: ParserSkillCategory | null;
  content_no: string | null;
  content_en: string | null;
  structured_data: S | null;
  dedupe_key: string | null;
  source_type: SourceType;
  source_ref: string | null;
  source_quote: string | null;
  /** 0–1, parserens egen sikkerhet. Ikke v4s confidence-akse. */
  parse_confidence: number | null;
  status: CandidateStatus;
  promoted_atom_id: string | null;
  question_ref: string | null;
  rejected_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Structured-data-skjemaer per atom-type
// ---------------------------------------------------------------------------

export interface RoleStructuredData {
  employer: string;
  employer_normalized?: string;
  title: string;
  start_date: string;          // YYYY-MM
  end_date: string | null;     // YYYY-MM eller null
  location: string | null;
  employment_type:
    | "fulltime"
    | "parttime"
    | "contract"
    | "freelance"
    | "internship"
    | null;
  industry: string | null;
  employer_size: "startup" | "sme" | "large" | "enterprise" | null;
  employer_description: string | null;
  is_current: boolean;
  /** Antall direkterapporterende, når CV-en oppgir det. Vises ved leadership-vurdering. */
  direct_reports: number | null;
}

export interface AchievementStructuredData {
  what: string;
  how_measured: string | null;
  how_done: string | null;
  challenge: string | null;
  action: string | null;
  result: string | null;
  category:
    | "leadership"
    | "sales"
    | "product"
    | "operations"
    | "technical"
    | "team"
    | "change"
    | "other"
    | null;
  scope_team_size: number | null;
  scope_budget_text: string | null;
  date_period: string | null;
  is_team_achievement: boolean;
}

export interface MetricStructuredData {
  value: number;
  unit: string;
  metric_type:
    | "revenue"
    | "growth"
    | "team_size"
    | "cost_savings"
    | "time_to_market"
    | "satisfaction"
    | "other";
  period: string | null;
  comparison: string | null;
  is_estimate: boolean;
  measurement_method: string | null;
}

export interface ContextStructuredData {
  context_type:
    | "reporting_line"
    | "team_size"
    | "organizational"
    | "business_context"
    | "other";
  detail: string;
}

export interface ToolStructuredData {
  name: string;
  tool_kind: "crm" | "methodology" | "platform" | "framework" | "other";
  proficiency: "expert" | "proficient" | "familiar" | null;
  years_used: number | null;
}

export interface EducationStructuredData {
  institution: string;
  institution_normalized?: string;
  degree: string;
  field: string | null;
  start_year: number;
  end_year: number | null;
  thesis_title: string | null;
  honors: string | null;
  grade: string | null;
}

export interface SkillStructuredData {
  name: string;
  name_normalized?: string;
  /**
   * Parserens grovkategori — kun et forslagsgrunnlag. Den er IKKE en klasse.
   * atom_class settes av databasen ut fra resolved_atom_type.
   */
  source_category: ParserSkillCategory;
  proficiency: "expert" | "proficient" | "familiar" | null;
  years_used: number | null;
}

/** Eksponering: felt eller bransje brukeren har vært borti gjennom en rolle. */
export interface DomainStructuredData {
  name: string;
  name_normalized?: string;
  years_exposed: number | null;
}

export interface LanguageStructuredData {
  language: string;
  level: "native" | "fluent" | "professional" | "conversational" | "basic";
  cefr: "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | null;
}

export interface CertificationStructuredData {
  name: string;
  issuer: string;
  issued_date: string | null;   // YYYY-MM
  expires_date: string | null;
  credential_id: string | null;
  credential_url: string | null;
}

export interface ProjectStructuredData {
  name: string;
  description: string;
  role_in_project: string | null;
  start_date: string | null;    // YYYY-MM
  end_date: string | null;
  url: string | null;
  technologies: string[];
  outcomes: string[];
}

export interface VolunteerStructuredData {
  organization: string;
  role: string;
  start_date: string;           // YYYY-MM
  end_date: string | null;
  cause: string | null;
}

export interface SummaryFragmentStructuredData {
  fragment_type:
    | "value_proposition"
    | "experience_summary"
    | "specialization"
    | "motivation"
    | "differentiator";
  weight: number;
}

export type AnyStructuredData =
  | RoleStructuredData
  | AchievementStructuredData
  | MetricStructuredData
  | ContextStructuredData
  | ToolStructuredData
  | EducationStructuredData
  | SkillStructuredData
  | DomainStructuredData
  | LanguageStructuredData
  | CertificationStructuredData
  | ProjectStructuredData
  | VolunteerStructuredData
  | SummaryFragmentStructuredData;

export type CvParseCandidate = CandidateBase<AnyStructuredData>;

// ---------------------------------------------------------------------------
// Utkast fra konvertererne — før import_id og user_id er kjent
// ---------------------------------------------------------------------------

export interface CandidateDraft {
  local_ref: string;
  parent_local_ref: string | null;
  suggested_atom_type: AtomType;
  suggested_from_category: ParserSkillCategory | null;
  content_no: string | null;
  content_en: string | null;
  structured_data: AnyStructuredData;
  dedupe_key: string | null;
  source_type: SourceType;
  source_ref: string | null;
  source_quote: string | null;
  parse_confidence: number | null;
}

/** Rad klar for innsetting i cv_parse_candidates. */
export type CandidateInsert = CandidateDraft & {
  user_id: string;
  import_id: string;
};

export function toCandidateInsert(
  draft: CandidateDraft,
  ctx: { user_id: string; import_id: string },
): CandidateInsert {
  return { ...draft, user_id: ctx.user_id, import_id: ctx.import_id };
}

// ---------------------------------------------------------------------------
// Type-guards på foreslått type
// ---------------------------------------------------------------------------

export function isSuggested<T extends AtomType>(
  c: { suggested_atom_type: AtomType },
  type: T,
): boolean {
  return c.suggested_atom_type === type;
}

/** Typen kandidaten faktisk skal bli: brukerens valg om det finnes, ellers forslaget. */
export function effectiveAtomType(c: {
  suggested_atom_type: AtomType;
  resolved_atom_type?: AtomType | null;
}): AtomType {
  return c.resolved_atom_type ?? c.suggested_atom_type;
}

// ---------------------------------------------------------------------------
// Parsing fra databaserader
// ---------------------------------------------------------------------------

/**
 * Konverter en rad fra cv_parse_candidates til en typesikker kandidat.
 * Kaster hvis raden mangler påkrevde felt.
 */
export function parseCandidateRow(row: Record<string, unknown>): CvParseCandidate {
  if (!row.id || typeof row.id !== "string") {
    throw new Error("parseCandidateRow: missing id");
  }
  if (!row.suggested_atom_type || typeof row.suggested_atom_type !== "string") {
    throw new Error("parseCandidateRow: missing suggested_atom_type");
  }
  if (!row.local_ref || typeof row.local_ref !== "string") {
    throw new Error("parseCandidateRow: missing local_ref");
  }
  return row as unknown as CvParseCandidate;
}

// ---------------------------------------------------------------------------
// Hjelpefunksjoner for opprettelse
// ---------------------------------------------------------------------------

export interface CreateDraftInput<S> {
  local_ref: string;
  structured_data: S;
  source_type: SourceType;
  parent_local_ref?: string | null;
  content_no?: string | null;
  content_en?: string | null;
  source_ref?: string | null;
  source_quote?: string | null;
  dedupe_key?: string | null;
  parse_confidence?: number | null;
  suggested_from_category?: ParserSkillCategory | null;
}

function draft<S extends AnyStructuredData>(
  atomType: AtomType,
  input: CreateDraftInput<S>,
): CandidateDraft {
  return {
    local_ref: input.local_ref,
    parent_local_ref: input.parent_local_ref ?? null,
    suggested_atom_type: atomType,
    suggested_from_category: input.suggested_from_category ?? null,
    content_no: input.content_no ?? null,
    content_en: input.content_en ?? null,
    structured_data: input.structured_data,
    dedupe_key: input.dedupe_key ?? null,
    source_type: input.source_type,
    source_ref: input.source_ref ?? null,
    source_quote: input.source_quote ?? null,
    parse_confidence: input.parse_confidence ?? null,
  };
}

export const createRoleDraft = (i: CreateDraftInput<RoleStructuredData>) =>
  draft("role", i);
export const createAchievementDraft = (
  i: CreateDraftInput<AchievementStructuredData> & { parent_local_ref: string },
) => draft("achievement", i);
export const createMetricDraft = (
  i: CreateDraftInput<MetricStructuredData> & { parent_local_ref: string },
) => draft("metric", i);
export const createEducationDraft = (i: CreateDraftInput<EducationStructuredData>) =>
  draft("education", i);
export const createSkillDraft = (i: CreateDraftInput<SkillStructuredData>) =>
  draft("skill", i);
export const createDomainDraft = (i: CreateDraftInput<DomainStructuredData>) =>
  draft("domain", i);
export const createToolDraft = (i: CreateDraftInput<ToolStructuredData>) =>
  draft("tool", i);
export const createLanguageDraft = (i: CreateDraftInput<LanguageStructuredData>) =>
  draft("language", i);
export const createCertificationDraft = (
  i: CreateDraftInput<CertificationStructuredData>,
) => draft("certification", i);
export const createProjectDraft = (i: CreateDraftInput<ProjectStructuredData>) =>
  draft("project", i);
export const createVolunteerDraft = (i: CreateDraftInput<VolunteerStructuredData>) =>
  draft("volunteer", i);
export const createSummaryFragmentDraft = (
  i: CreateDraftInput<SummaryFragmentStructuredData>,
) => draft("summary_fragment", i);
