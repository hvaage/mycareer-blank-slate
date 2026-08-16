// cv-ats-rules-no — TypeScript types
// Skjema-versjon: 1.0
// Brukes av rendering-pipeline og validator-pipeline.

// ---------------------------------------------------------------------------
// CV-utkast — datastrukturen som rendering tar imot og validator validerer
// ---------------------------------------------------------------------------

export type Language = "no" | "en";

export interface CvDraftHeader {
  full_name: string;
  headline: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  linkedin_url: string | null;
  website_url: string | null;
  // Valgfri data brukeren har eksplisitt aktivert
  birth_year: number | null;
  nationality: string | null;
  has_profile_photo: boolean;
}

export interface CvDraftRoleEntry {
  title: string;
  employer: string;
  location: string | null;
  start_date: string;        // YYYY-MM (rendering konverterer til "MMM ÅÅÅÅ")
  end_date: string | null;   // YYYY-MM eller null hvis pågående
  is_current: boolean;
  description: string | null;
  achievements: string[];    // hver er en bullet
  atom_ids?: string[];
  achievement_atom_ids?: string[][];
}

export interface CvDraftEducationEntry {
  degree: string;
  field: string | null;
  institution: string;
  location: string | null;
  start_year: number;
  end_year: number | null;
  thesis: string | null;
  honors: string | null;
}

export interface CvDraftSkill {
  name: string;
  category: string;
  proficiency: string | null;
}

export interface CvDraftLanguage {
  language: string;
  level: string;
}

export interface CvDraftCertification {
  name: string;
  issuer: string;
  issued_date: string | null;  // YYYY-MM
  expires_date: string | null;
}

export interface CvDraftProject {
  name: string;
  description: string;
  role_in_project: string | null;
  start_date: string | null;
  end_date: string | null;
  url: string | null;
  technologies: string[];
}

export interface CvDraftVolunteer {
  organization: string;
  role: string;
  start_date: string;
  end_date: string | null;
  description: string | null;
}

export interface CvDraft {
  language: Language;
  header: CvDraftHeader;
  summary: string | null;            // profilsammendrag
  roles: CvDraftRoleEntry[];
  educations: CvDraftEducationEntry[];
  skills: CvDraftSkill[];
  languages: CvDraftLanguage[];
  certifications: CvDraftCertification[];
  projects: CvDraftProject[];
  volunteer: CvDraftVolunteer[];
  // Metadata for rendering
  font_family?: string;
  base_font_size_pt?: number;
}

// ---------------------------------------------------------------------------
// Validation — output fra validatoren
// ---------------------------------------------------------------------------

export type ViolationSeverity = "error" | "warning" | "info";

export type ViolationCategory =
  | "format"
  | "content"
  | "language"
  | "gdpr";

export interface AtsViolation {
  severity: ViolationSeverity;
  category: ViolationCategory;
  rule_id: string;             // f.eks. "format.font_not_safe"
  message: string;             // forklaring til brukeren (på norsk)
  field_path: string | null;   // f.eks. "roles[0].achievements[2]" hvis aktuelt
  suggestion: string | null;   // konkret forbedringsforslag
}

export interface AtsCheckResult {
  ok: boolean;                 // true hvis ingen errors (warnings tillatt)
  violations: AtsViolation[];
  errors: AtsViolation[];      // subset
  warnings: AtsViolation[];    // subset
  infos: AtsViolation[];       // subset
  rules_version: string;
}

export interface TargetKeyword {
  term: string;
  aliases: string[];
  importance: "required" | "preferred" | "context";
  requirement_atom_id: string | null;
}

export interface CandidateEvidenceTerm {
  term: string;
  aliases: string[];
  atom_ids: string[];
  user_confirmed: boolean;
}

export interface KeywordMatch {
  keyword: TargetKeyword;
  status: "exact" | "normalized" | "semantic_alias" | "unsupported";
  matched_term: string | null;
  supporting_atom_ids: string[];
}

export interface AtsRelevanceResult {
  matches: KeywordMatch[];
  supported: KeywordMatch[];
  unsupported: KeywordMatch[];
  coverage_percent: number;
  exact_count: number;
  supported_count: number;
  total_weighted: number;
  supported_weighted: number;
  rule: "never_add_unsupported_keyword";
}

// ---------------------------------------------------------------------------
// Rendering-konstanter — importeres av rendering-pipeline
// ---------------------------------------------------------------------------

export interface SectionHeaders {
  summary: string;
  experience: string;
  education: string;
  skills: string;
  languages: string;
  certifications: string;
  projects: string;
  volunteer: string;
}

export interface MonthAbbreviations {
  [monthNumber: string]: string;  // "01" → "jan."
}
