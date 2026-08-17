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

/**
 * Hvor godt en påstand i teksten er belagt i brukerens bekreftede grunnlag.
 * Dette er den maskinelle verifikasjonen fra hallusinasjonsvakten.
 * `user_attested` settes ALDRI av vakten — bare av brukerens egen bekreftelse.
 */
export const CLAIM_VERIFICATIONS = [
  "supported",
  "partially_supported",
  "unsupported",
  "not_applicable",
  "user_attested",
  "contradicted",
] as const;
export type ClaimVerification = (typeof CLAIM_VERIFICATIONS)[number];

/**
 * Evidensklassifisering slik den presenteres for brukeren.
 * - documented: dekket av dokumentert grunnlag
 * - user_attested: brukeren står selv inne for opplysningen
 * - partially_supported: delvis dekket — mangler presisjon eller omfang
 * - unsupported: ingen dekning i grunnlaget
 * - contradicted: grunnlaget sier noe annet
 */
export const EVIDENCE_STATUSES = [
  "documented",
  "user_attested",
  "partially_supported",
  "unsupported",
  "contradicted",
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const EVIDENCE_STATUS_TEXT: Record<EvidenceStatus, string> = {
  documented: "Dokumentert i grunnlaget ditt",
  user_attested: "Bekreftet av deg",
  partially_supported: "Delvis dekket av grunnlaget",
  unsupported: "Ikke dekket av grunnlaget",
  contradicted: "Strider mot grunnlaget",
};

/** Evidensstatuser som kan godkjennes og eksporteres. */
export const APPROVABLE_EVIDENCE_STATUSES = ["documented", "user_attested"] as const;

export function isApprovalBlocking(status: EvidenceStatus): boolean {
  return !(APPROVABLE_EVIDENCE_STATUSES as readonly string[]).includes(status);
}

/**
 * Maskinell verifikasjon + gyldig brukerbekreftelse -> evidensstatus.
 * En bekreftelse gjelder bare teksten den ble gitt for. Endres teksten,
 * er bekreftelsen ikke lenger gyldig og statusen faller tilbake.
 */
export function evidenceStatusFor(
  verification: ClaimVerification,
  hasValidAttestation: boolean,
): EvidenceStatus {
  if (verification === "supported" || verification === "not_applicable") return "documented";
  // Motstrid kan ikke overstyres av en bekreftelse: grunnlaget må rettes først.
  if (verification === "contradicted") return "contradicted";
  if (hasValidAttestation) return "user_attested";
  if (verification === "user_attested") return "unsupported";
  return verification === "partially_supported" ? "partially_supported" : "unsupported";
}

/** Handlinger brukeren kan velge i gjennomgangen av en påstand. */
export const CLAIM_REVIEW_ACTIONS = ["attest", "rewrite", "add_documentation", "remove"] as const;
export type ClaimReviewAction = (typeof CLAIM_REVIEW_ACTIONS)[number];

export const CLAIM_REVIEW_ACTION_TEXT: Record<ClaimReviewAction, string> = {
  attest: "Bekreft som egen opplysning",
  rewrite: "Omskriv slik at den følger grunnlaget",
  add_documentation: "Legg til dokumentasjon",
  remove: "Fjern formuleringen",
};

export function claimReviewActionsFor(status: EvidenceStatus): ClaimReviewAction[] {
  if (status === "documented") return [];
  if (status === "user_attested") return ["rewrite", "add_documentation", "remove"];
  return ["attest", "rewrite", "add_documentation", "remove"];
}

/**
 * Intern merknad ved brukerbekreftelse. Vises bare i gjennomgangen —
 * den skal aldri havne i den eksporterte CV-teksten.
 */
export const USER_ATTESTED_INTERNAL_NOTE =
  "Bekreftet av deg. Oppgitt ekstern dokumentasjon er ikke tilgjengelig.";

/** Hvordan en bekreftelse ble til. Kanalen er alltid brukerens egen handling. */
export type AttestationProvenance = {
  channel: "user_review_ui";
  actor: "user";
  /** Verifikasjonen påstanden hadde da brukeren bekreftet den. */
  verificationAtAttestation: ClaimVerification | null;
  /** Versjonsnummer for bekreftelsen av denne påstanden. */
  claimVersion: number;
  /** Dokumentversjonens outputHash da bekreftelsen ble gitt, om kjent. */
  documentOutputHash: string | null;
};

/** Brukerens egen bekreftelse av en påstand. */
export type UserAttestation = {
  claimId: string;
  attestedAt: string;
  attestedClaimText: string;
  note: string | null;
  externalSourceName: string | null;
  externalSourceYear: number | null;
  externalDocumentAvailable: boolean;
  /** False når teksten er endret etter bekreftelsen. Krever ny bekreftelse. */
  valid: boolean;
  withdrawnAt: string | null;
  invalidatedAt: string | null;
  invalidatedReason: string | null;
  provenance: AttestationProvenance;
  /** Intern merknad. Aldri en del av eksportert tekst. */
  internalNote: string;
};

/** Del av en påstand som mangler dekning i grunnlaget. */
export type UnsupportedElement = {
  /** Hva slags element: tall, dato, marked, geografi, sammenligning, annet. */
  kind: "number" | "date" | "market" | "geography" | "comparison" | "causality" | "other";
  text: string;
  reason: string;
};

/** Registrert motstrid mellom påstand og grunnlag. */
export type ClaimContradiction = {
  text: string;
  conflictingAtomIds: string[];
  reason: string;
};

/**
 * Deterministisk oppdeling av hva i en påstand som mangler dekning.
 * Ingen modellkall — bare klassifisering av teksten brukeren skal ta stilling til.
 */
export function classifyUnsupportedElements(
  value: string,
  verification: ClaimVerification,
): UnsupportedElement[] {
  if (verification === "supported" || verification === "not_applicable") return [];
  const elements: UnsupportedElement[] = [];
  const push = (kind: UnsupportedElement["kind"], text: string, reason: string) => {
    if (!elements.some((e) => e.text === text && e.kind === kind)) elements.push({ kind, text, reason });
  };
  for (const m of value.match(/\b(19|20)\d{2}\b/g) ?? []) {
    push("date", m, "Årstallet er ikke belagt i grunnlaget ditt.");
  }
  for (const m of value.match(/\b\d[\d\s.,]*\s?(%|prosent|mill\.?|millioner|milliarder|personer|ansatte)?\b/g) ??
    []) {
    const t = m.trim();
    if (t.length === 0 || /^(19|20)\d{2}$/.test(t)) continue;
    push("number", t, "Tallet er ikke belagt i grunnlaget ditt.");
  }
  for (const m of value.match(/\b(størst|ledende|markedsledende|først|eneste|nest største|best)\w*/gi) ?? []) {
    push("comparison", m, "Sammenligningen er ikke belagt i grunnlaget ditt.");
  }
  for (const m of value.match(/\b(B2C|B2B|marked\w*)\b/gi) ?? []) {
    push("market", m, "Markedsomfanget er ikke belagt i grunnlaget ditt.");
  }
  for (const m of value.match(/\b(Norge|norsk\w*|Norden|nordisk\w*|Europa|globalt)\b/gi) ?? []) {
    push("geography", m, "Geografien er ikke belagt i grunnlaget ditt.");
  }
  if (elements.length === 0) {
    push("other", value, "Formuleringen er ikke belagt i grunnlaget ditt.");
  }
  return elements;
}


export type ClaimEvidence = {
  claimId: string;
  blockId: string;
  type: ClaimType;
  value: string;
  verification: ClaimVerification;
  evidenceStatus: EvidenceStatus;
  approvalBlocking: boolean;
  supportingAtomIds: string[];
  availableActions: ClaimReviewAction[];
  userAttestation: UserAttestation | null;
  unsupportedElements: UnsupportedElement[];
  contradiction: ClaimContradiction | null;
};

export type DocumentEvidenceReport = {
  documentId: string;
  canApprove: boolean;
  blockingClaimIds: string[];
  documentedCoverage: Record<EvidenceStatus, number> & { total: number };
  claims: ClaimEvidence[];
};

/**
 * En bekreftelse gjelder nøyaktig den påstandsteksten brukeren bekreftet.
 * Enhver faktisk endring av teksten — tall, år, marked, geografi,
 * sammenligning eller styrke — gjør bekreftelsen ugyldig. Bare en teknisk
 * no-op (identisk lagret tekst, kun ytre blanktegn kan avvike) bevarer den.
 * Verken modell eller deterministisk omskriving kan videreføre eller
 * opprette user_attested; det krever en ny handling fra brukeren.
 * Speiler databasetriggeren, som sammenligner md5(btrim(tekst)).
 */
export function attestationSurvivesRewrite(previousText: string, nextText: string): boolean {
  return previousText.trim() === nextText.trim();
}


export function summarizeEvidence(
  documentId: string,
  claims: ClaimEvidence[],
): DocumentEvidenceReport {
  const coverage = {
    documented: 0,
    user_attested: 0,
    partially_supported: 0,
    unsupported: 0,
    contradicted: 0,
    total: claims.length,
  };
  for (const c of claims) coverage[c.evidenceStatus] += 1;
  const blockingClaimIds = claims.filter((c) => c.approvalBlocking).map((c) => c.claimId);
  return {
    documentId,
    canApprove: blockingClaimIds.length === 0 && claims.length > 0,
    blockingClaimIds,
    documentedCoverage: coverage,
    claims,
  };
}


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

/**
 * Operative grenser for den rolleblokkbaserte v2.1-atomiseringen.
 * perCall gjelder ett modellkall (én rolleblokk med kontekst).
 * perSelection gjelder hele importutvalget som planlegges i én jobb.
 *
 * Disse grensene gjelder KUN den aktive jobbruten
 * (POST /api/cv/atomization-jobs). Den eldre engangsruten har egne,
 * lavere grenser — se CV_PROPOSAL_LEGACY_LIMITS. Ikke slå dem sammen i UI.
 */
export const CV_PROPOSAL_LIMITS = {
  // v2.1 sender rolleblokker med kontekst, ikke løsrevne segmenter.
  perCall: { maxCandidates: 80, maxChars: 60_000 },
  perSelection: { maxCandidates: 120, maxChars: 120_000 },
} as const;

/**
 * Grenser for den aktive v2.1-jobbruten POST /api/cv/atomization-jobs.
 * Serveren håndhever nøyaktig disse tallene; UI må aldri vise høyere tall.
 */
export const CV_ATOMIZATION_JOB_LIMITS = {
  perJob: {
    maxCandidates: CV_PROPOSAL_LIMITS.perSelection.maxCandidates,
    maxChars: CV_PROPOSAL_LIMITS.perSelection.maxChars,
  },
} as const;

/**
 * Grenser for den eldre engangsruten POST /api/cv/propose-cv-atoms.
 * Ruten er ikke en del av den ordinære brukerreisen, og håndhever egne,
 * lavere grenser eksplisitt.
 */
export const CV_PROPOSAL_LEGACY_LIMITS = {
  perCall: { maxCandidates: 20, maxChars: 20_000 },
  perSelection: { maxCandidates: 60, maxChars: 60_000 },
} as const;


/** Alle feilkoder POST /api/cv/propose-cv-atoms kan svare med. Frontend definerer ingen egne. */
export const CV_PROPOSAL_ERROR_CODES = [
  "method_not_allowed",
  "invalid_origin",
  "invalid_body",
  "invalid_candidates",
  "no_candidates",
  "too_many_candidates",
  "input_too_large",
  "unauthorized",
  "forbidden",
  "not_found",
  "active_run",
  "rate_limited",
  "provider_error",
  "provider_timeout",
  "blocked_validation",
  "configuration_error",
  "server_misconfigured",
  "database_error",
  "network_error",
] as const;
export type CvProposalErrorCode = (typeof CV_PROPOSAL_ERROR_CODES)[number];

/** Produkttekst per feilkode. Ingen modellnavn, versjoner, hasher eller tabellnavn. */
export const CV_PROPOSAL_ERROR_TEXT: Record<CvProposalErrorCode, string> = {
  method_not_allowed: "Kunne ikke analyseres akkurat nå.",
  invalid_origin: "Kunne ikke analyseres akkurat nå.",
  invalid_body: "Ugyldig utvalg. Velg funn fra denne CV-en og prøv igjen.",
  invalid_candidates: "Ugyldig utvalg. Velg funn fra denne CV-en og prøv igjen.",
  no_candidates: "Ingen funn å analysere i dette utvalget.",
  too_many_candidates: "For mange funn i én analyse. Del opp utvalget.",
  input_too_large: "For mye tekst i én analyse. Del opp utvalget.",
  unauthorized: "Innloggingen din er utløpt. Logg inn på nytt.",
  forbidden: "Du har ikke tilgang til denne CV-en.",
  not_found: "Fant ikke denne CV-en.",
  active_run: "En analyse pågår allerede. Vent til den er ferdig.",
  rate_limited: "For mange forsøk. Prøv igjen om litt.",
  provider_error: "Kunne ikke analyseres akkurat nå. Prøv igjen.",
  provider_timeout: "Analysen tok for lang tid. Prøv igjen.",
  blocked_validation: "Analysen ga ikke et resultat vi kunne bruke. Prøv igjen.",
  configuration_error: "Analysen er ikke tilgjengelig akkurat nå.",
  server_misconfigured: "Analysen er ikke tilgjengelig akkurat nå.",
  database_error: "Kunne ikke analyseres akkurat nå. Prøv igjen.",
  network_error: "Mistet forbindelsen. Prøv igjen.",
};

/** Feilkoder det er meningsfullt å prøve på nytt uten å endre utvalget. */
export const CV_PROPOSAL_RETRYABLE_ERROR_CODES = [
  "provider_error",
  "provider_timeout",
  "blocked_validation",
  "database_error",
  "network_error",
  "rate_limited",
  "active_run",
] as const;

/** Hvordan et forslag presenteres for brukeren. */
export const CV_PROPOSAL_REVIEW_STATES = ["new", "existing", "needs_more_context"] as const;
export type CvProposalReviewState = (typeof CV_PROPOSAL_REVIEW_STATES)[number];

export const CV_PROPOSAL_REVIEW_STATE_TEXT: Record<CvProposalReviewState, string> = {
  new: "Forslag klart for gjennomgang",
  existing: "Finnes allerede",
  needs_more_context: "Trenger mer informasjon",
};

/** Fremdriftstekst for en oppdelt analyse. */
export function cvAnalysisProgressText(done: number, total: number): string {
  if (total <= 1) return done >= 1 ? "Analyse gjennomført" : "Analyserer erfaringene dine …";
  return done >= total
    ? `${total} av ${total} analyser gjennomført`
    : `${done} av ${total} analyser gjennomført`;
}

// #endregion generated-dto-contract
