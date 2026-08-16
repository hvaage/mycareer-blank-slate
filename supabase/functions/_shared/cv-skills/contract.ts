// KANONISK KONTRAKT for CV-skillflyten. Backend eier denne filen.
//
// Alt mellom DTO-markørene under er delt med frontend og genereres til
// src/lib/cv-skills-contract.ts via `node scripts/generate-cv-skills-contract.mjs`.
// Rediger ALDRI den genererte frontendfilen direkte.
//
// Autoritativ logikk (eligibility, readiness-vurdering) ligger utenfor
// DTO-blokken og skal aldri eksporteres til frontend.

// #region generated-dto-contract
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

/**
 * Utfall av ett modellsteg.
 * configuration_error = kallet er ugyldig for valgt modellprofil. Ingen
 * Anthropic-request sendes, og steget skal aldri retryes.
 */
export const STEP_OUTCOMES = [
  "ok",
  "needs_review",
  "blocked_validation",
  "blocked_guard",
  "provider_error",
  "timeout",
  "configuration_error",
] as const;
export type StepOutcome = (typeof STEP_OUTCOMES)[number];

/** Utfall som aldri skal retryes. */
export const NON_RETRYABLE_STEP_OUTCOMES = ["configuration_error", "blocked_guard"] as const;

// #endregion generated-dto-contract
