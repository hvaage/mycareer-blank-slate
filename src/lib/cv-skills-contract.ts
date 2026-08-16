// GENERERT FIL — IKKE REDIGER.
//
// Kilde: supabase/functions/_shared/cv-skills/contract.ts (kanonisk backendkontrakt)
// Generer på nytt: node scripts/generate-cv-skills-contract.mjs
//
// Bare DTO-kontrakten deles med frontend. Eligibility og readiness-vurdering
// er autoritativ backendlogikk og kjøres aldri i nettleseren.

/** Hvor klar brukerens grunnlag er for CV-generering. */
export const READINESS_STATUSES = [
  "ready",
  "ready_with_gaps",
  "needs_review",
  "blocked_no_evidence",
] as const;
export type ReadinessStatus = (typeof READINESS_STATUSES)[number];

/** Hvorfor et grunnlag er merket med gap eller blokkering. Ren data — ingen fri tekst fra modell. */
export const READINESS_REASONS = [
  "no_eligible_atoms",
  "open_proposals",
  "unresolved_conflicts",
  "few_results",
  "unsupported_requirements",
] as const;
export type ReadinessReason = (typeof READINESS_REASONS)[number];

export type ReadinessReport = {
  status: ReadinessStatus;
  reasons: ReadinessReason[];
  counts: {
    eligible: number;
    roles: number;
    results: number;
    qualifications: number;
    /** Avledet kompetanse. Brukes til utvalg og rangering — aldri som gap i seg selv. */
    derivedCompetence: number;
    openProposals: number;
    conflicts: number;
  };
};

/** Hvor godt en påstand i teksten er belagt i brukerens bekreftede grunnlag. */
export const CLAIM_VERIFICATIONS = [
  "supported",
  "partially_supported",
  "unsupported",
  "not_applicable",
] as const;
export type ClaimVerification = (typeof CLAIM_VERIFICATIONS)[number];

export type ClaimType = "hard" | "soft";

export type CvBlock = {
  blockId: string;
  section: string;
  text: string;
  supportingAtomIds: string[];
  requirementAtomIds: string[];
  claimIds: string[];
  sourceSnapshotHash: string;
};

export type CvClaim = {
  claimId: string;
  blockId: string;
  type: ClaimType;
  value: string;
  supportingAtomIds: string[];
  verification: ClaimVerification;
};

export type CvDocumentDraft = {
  documentVersionId: string;
  outputHash: string;
  snapshotHash: string;
  blocks: CvBlock[];
  claims: CvClaim[];
};

/** CV-variant. Kanonisk felt i databasen heter cv_variant. */
export type CvVariant = "general" | "tailored";

/** Jobbstatus slik frontend får den servert — sanitert, uten interne felt. */
export const JOB_STATUSES = [
  "queued",
  "running",
  "waiting_review",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type SanitizedJobStatus = {
  jobId: string;
  status: JobStatus;
  step: string | null;
  attemptCount: number;
  maxAttempts: number;
  updatedAt: string;
  /** Kort, brukervennlig feilkode — aldri rå leverandørfeil. */
  errorCode: string | null;
};

/** Utfall av ett modellsteg. */
export const STEP_OUTCOMES = [
  "ok",
  "needs_review",
  "blocked_validation",
  "blocked_guard",
  "provider_error",
  "timeout",
] as const;
export type StepOutcome = (typeof STEP_OUTCOMES)[number];
