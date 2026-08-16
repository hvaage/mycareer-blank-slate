// cv-evidence-graph — TypeScript types
// Skjema-versjon: 1.1 (additiv; nye semantikkfelt ligger i structured_data)
// Disse typene er kanoniske. Edge-funksjoner og frontend skal importere herfra.

// ---------------------------------------------------------------------------
// Felles enums
// ---------------------------------------------------------------------------

export type AtomType =
  | "role"
  | "achievement"
  | "metric"
  | "context"
  | "tool"
  | "education"
  | "skill"
  | "language"
  | "certification"
  | "project"
  | "volunteer"
  | "summary_fragment";

export type Confidence = "verified" | "imported" | "inferred";

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

// ---------------------------------------------------------------------------
// Base-atom — felles felter for alle typer
// Generic S = structured_data shape; spesifiseres per atom-type nedenfor.
// ---------------------------------------------------------------------------

export interface AtomBase<S = unknown> {
  id: string;
  user_id: string;
  atom_type: AtomType;
  parent_atom_id: string | null;
  content_no: string | null;
  content_en: string | null;
  structured_data: S | null;
  source_type: SourceType;
  source_ref: string | null;
  source_quote: string | null;
  confidence: Confidence;
  user_confirmed: boolean;
  user_locked: boolean;
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
  /** Stabil konseptnøkkel foreslått av cv-atom-language-no. */
  semantic_key?: string;
  /** Kildeformuleringer som uttrykker samme mulige fakta. */
  semantic_aliases?: string[];
  /** Bevarer styrkegrad; må aldri oppgraderes uten eksplisitt kildebelegg. */
  ownership_level?:
    | "observed"
    | "participated"
    | "contributed"
    | "coordinated"
    | "responsible"
    | "led"
    | "owned"
    | "unclear";
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
  semantic_key?: string;
}

export interface ToolStructuredData {
  name: string;
  category:
    | "crm"
    | "methodology"
    | "language"
    | "platform"
    | "framework"
    | "other";
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
  category:
    | "technical"
    | "leadership"
    | "language"
    | "tool"
    | "methodology"
    | "domain"
    | "soft"
    | "other";
  proficiency: "expert" | "proficient" | "familiar" | null;
  years_used: number | null;
  evidence_atom_ids: string[];
  semantic_key?: string;
  semantic_aliases?: string[];
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
  semantic_key?: string;
}

export type AtomProposalAction =
  | "create"
  | "update"
  | "merge"
  | "deactivate"
  | "flag_conflict";

export type AtomProposalStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "merged"
  | "needs_more_context"
  | "superseded";

export interface AtomProvenance {
  source_type: SourceType | string;
  source_id: string | null;
  source_hash: string;
  source_table: string | null;
  source_record_id: string | null;
  source_quote: string;
  source_segment_id: string | null;
  start_offset: number | null;
  end_offset: number | null;
}

export interface AtomProposal {
  schema_version: "1.1";
  proposal_id: string;
  user_id: string;
  action: AtomProposalAction;
  status: AtomProposalStatus;
  target_atom_id: string | null;
  proposed_atom: AtomInsert | null;
  existing_atom_snapshot: CvAtom | null;
  provenance: AtomProvenance;
  semantic_key: string | null;
  rationale: string;
  confidence: number;
  inferred: boolean;
  requires_user_confirmation: true;
}

// ---------------------------------------------------------------------------
// Diskriminerte unioner — gir typesikker tilgang til structured_data per type
// ---------------------------------------------------------------------------

export interface RoleAtom extends AtomBase<RoleStructuredData> {
  atom_type: "role";
}

export interface AchievementAtom extends AtomBase<AchievementStructuredData> {
  atom_type: "achievement";
}

export interface MetricAtom extends AtomBase<MetricStructuredData> {
  atom_type: "metric";
}

export interface ContextAtom extends AtomBase<ContextStructuredData> {
  atom_type: "context";
}

export interface ToolAtom extends AtomBase<ToolStructuredData> {
  atom_type: "tool";
}

export interface EducationAtom extends AtomBase<EducationStructuredData> {
  atom_type: "education";
}

export interface SkillAtom extends AtomBase<SkillStructuredData> {
  atom_type: "skill";
}

export interface LanguageAtom extends AtomBase<LanguageStructuredData> {
  atom_type: "language";
}

export interface CertificationAtom extends AtomBase<CertificationStructuredData> {
  atom_type: "certification";
}

export interface ProjectAtom extends AtomBase<ProjectStructuredData> {
  atom_type: "project";
}

export interface VolunteerAtom extends AtomBase<VolunteerStructuredData> {
  atom_type: "volunteer";
}

export interface SummaryFragmentAtom extends AtomBase<SummaryFragmentStructuredData> {
  atom_type: "summary_fragment";
}

export type CvAtom =
  | RoleAtom
  | AchievementAtom
  | MetricAtom
  | ContextAtom
  | ToolAtom
  | EducationAtom
  | SkillAtom
  | LanguageAtom
  | CertificationAtom
  | ProjectAtom
  | VolunteerAtom
  | SummaryFragmentAtom;

// ---------------------------------------------------------------------------
// Input-typer — partial, brukes ved opprettelse
// ---------------------------------------------------------------------------

export type AnyStructuredData =
  | RoleStructuredData
  | AchievementStructuredData
  | MetricStructuredData
  | ContextStructuredData
  | ToolStructuredData
  | EducationStructuredData
  | SkillStructuredData
  | LanguageStructuredData
  | CertificationStructuredData
  | ProjectStructuredData
  | VolunteerStructuredData
  | SummaryFragmentStructuredData;

export type AtomInsert = Omit<
  AtomBase<AnyStructuredData>,
  "id" | "created_at" | "updated_at" | "user_confirmed" | "user_locked" | "confidence"
> & {
  confidence?: Confidence;
  user_confirmed?: boolean;
  user_locked?: boolean;
};

// ---------------------------------------------------------------------------
// Type-guards
// ---------------------------------------------------------------------------

export function isRoleAtom(atom: CvAtom): atom is RoleAtom {
  return atom.atom_type === "role";
}
export function isAchievementAtom(atom: CvAtom): atom is AchievementAtom {
  return atom.atom_type === "achievement";
}
export function isMetricAtom(atom: CvAtom): atom is MetricAtom {
  return atom.atom_type === "metric";
}
export function isEducationAtom(atom: CvAtom): atom is EducationAtom {
  return atom.atom_type === "education";
}
export function isSkillAtom(atom: CvAtom): atom is SkillAtom {
  return atom.atom_type === "skill";
}
export function isLanguageAtom(atom: CvAtom): atom is LanguageAtom {
  return atom.atom_type === "language";
}
export function isCertificationAtom(atom: CvAtom): atom is CertificationAtom {
  return atom.atom_type === "certification";
}
export function isProjectAtom(atom: CvAtom): atom is ProjectAtom {
  return atom.atom_type === "project";
}
export function isVolunteerAtom(atom: CvAtom): atom is VolunteerAtom {
  return atom.atom_type === "volunteer";
}
export function isContextAtom(atom: CvAtom): atom is ContextAtom {
  return atom.atom_type === "context";
}
export function isToolAtom(atom: CvAtom): atom is ToolAtom {
  return atom.atom_type === "tool";
}
export function isSummaryFragmentAtom(atom: CvAtom): atom is SummaryFragmentAtom {
  return atom.atom_type === "summary_fragment";
}

// ---------------------------------------------------------------------------
// Parsing fra databaserader (Supabase returnerer structured_data som unknown JSON)
// ---------------------------------------------------------------------------

/**
 * Konverter en rad fra cv_evidence_atoms-tabellen til en typesikker CvAtom.
 * Kaster hvis raden mangler påkrevde felt eller atom_type er ukjent.
 */
export function parseAtomRow(row: Record<string, unknown>): CvAtom {
  if (!row.id || typeof row.id !== "string") {
    throw new Error("parseAtomRow: missing id");
  }
  if (!row.atom_type || typeof row.atom_type !== "string") {
    throw new Error("parseAtomRow: missing atom_type");
  }
  return row as unknown as CvAtom;
}

// ---------------------------------------------------------------------------
// Hjelpefunksjoner for opprettelse — sikrer riktig type på structured_data
// ---------------------------------------------------------------------------

export interface CreateAtomInput<T extends AtomType, S> {
  user_id: string;
  source_type: SourceType;
  structured_data: S;
  content_no?: string | null;
  content_en?: string | null;
  parent_atom_id?: string | null;
  source_ref?: string | null;
  source_quote?: string | null;
  confidence?: Confidence;
  user_confirmed?: boolean;
}

export function createRoleAtom(
  input: CreateAtomInput<"role", RoleStructuredData>,
): AtomInsert {
  return {
    atom_type: "role",
    user_id: input.user_id,
    parent_atom_id: input.parent_atom_id ?? null,
    content_no: input.content_no ?? null,
    content_en: input.content_en ?? null,
    structured_data: input.structured_data,
    source_type: input.source_type,
    source_ref: input.source_ref ?? null,
    source_quote: input.source_quote ?? null,
    confidence: input.confidence ?? "verified",
    user_confirmed: input.user_confirmed ?? false,
  };
}

export function createAchievementAtom(
  input: CreateAtomInput<"achievement", AchievementStructuredData> & {
    parent_atom_id: string;
  },
): AtomInsert {
  return {
    atom_type: "achievement",
    user_id: input.user_id,
    parent_atom_id: input.parent_atom_id,
    content_no: input.content_no ?? null,
    content_en: input.content_en ?? null,
    structured_data: input.structured_data,
    source_type: input.source_type,
    source_ref: input.source_ref ?? null,
    source_quote: input.source_quote ?? null,
    confidence: input.confidence ?? "verified",
    user_confirmed: input.user_confirmed ?? false,
  };
}

export function createMetricAtom(
  input: CreateAtomInput<"metric", MetricStructuredData> & {
    parent_atom_id: string;
  },
): AtomInsert {
  return {
    atom_type: "metric",
    user_id: input.user_id,
    parent_atom_id: input.parent_atom_id,
    content_no: input.content_no ?? null,
    content_en: input.content_en ?? null,
    structured_data: input.structured_data,
    source_type: input.source_type,
    source_ref: input.source_ref ?? null,
    source_quote: input.source_quote ?? null,
    confidence: input.confidence ?? "verified",
    user_confirmed: input.user_confirmed ?? false,
  };
}

export function createEducationAtom(
  input: CreateAtomInput<"education", EducationStructuredData>,
): AtomInsert {
  return {
    atom_type: "education",
    user_id: input.user_id,
    parent_atom_id: null,
    content_no: input.content_no ?? null,
    content_en: input.content_en ?? null,
    structured_data: input.structured_data,
    source_type: input.source_type,
    source_ref: input.source_ref ?? null,
    source_quote: input.source_quote ?? null,
    confidence: input.confidence ?? "verified",
    user_confirmed: input.user_confirmed ?? false,
  };
}

export function createSkillAtom(
  input: CreateAtomInput<"skill", SkillStructuredData>,
): AtomInsert {
  return {
    atom_type: "skill",
    user_id: input.user_id,
    parent_atom_id: null,
    content_no: input.content_no ?? null,
    content_en: input.content_en ?? null,
    structured_data: input.structured_data,
    source_type: input.source_type,
    source_ref: input.source_ref ?? null,
    source_quote: input.source_quote ?? null,
    confidence: input.confidence ?? "verified",
    user_confirmed: input.user_confirmed ?? false,
  };
}

export function createLanguageAtom(
  input: CreateAtomInput<"language", LanguageStructuredData>,
): AtomInsert {
  return {
    atom_type: "language",
    user_id: input.user_id,
    parent_atom_id: null,
    content_no: input.content_no ?? null,
    content_en: input.content_en ?? null,
    structured_data: input.structured_data,
    source_type: input.source_type,
    source_ref: input.source_ref ?? null,
    source_quote: input.source_quote ?? null,
    confidence: input.confidence ?? "verified",
    user_confirmed: input.user_confirmed ?? false,
  };
}

export function createCertificationAtom(
  input: CreateAtomInput<"certification", CertificationStructuredData>,
): AtomInsert {
  return {
    atom_type: "certification",
    user_id: input.user_id,
    parent_atom_id: null,
    content_no: input.content_no ?? null,
    content_en: input.content_en ?? null,
    structured_data: input.structured_data,
    source_type: input.source_type,
    source_ref: input.source_ref ?? null,
    source_quote: input.source_quote ?? null,
    confidence: input.confidence ?? "verified",
    user_confirmed: input.user_confirmed ?? false,
  };
}
