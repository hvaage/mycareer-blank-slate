// Karriereontologi v4, fase 2.1: evidensgrunnlaget byttet fra user_evidence_atoms
// til career_atoms. Scoringer mot ulike grunnlag kan ikke sammenlignes.
// Fase 0 (jobb-leads v3): grunnlaget er strammet inn til user_confirmed=true.
// 2026-08-25: rolleporten forstår nå produktets rollefamilier (f.eks. Salg → CCO),
// ikke bare eksakte stillingstitler. Semantikken er endret, derfor ny versjon.
export const MATCH_SCORE_VERSION = "job_match_v5_2026_08_25";
/** Forrige versjon. Rader med denne er scoret før rollefamilie-taksonomien. */
export const MATCH_SCORE_VERSION_LEGACY = "job_match_v4_2026_08_23";

export type ScreeningStatus = "eligible" | "excluded" | "needs_review";
export type ScreeningSeverity = "hard_filter" | "review";

export type ScreeningReason = {
  code: string;
  label: string;
  severity: ScreeningSeverity;
  evidence?: string;
};

export type EvidenceItem = {
  ref: string;
  category: string;
  label: string;
  description?: string | null;
};

export type ScreeningProfile = {
  target_roles: string[];
  preferred_locations: string[];
  target_city?: string | null;
  target_region?: string | null;
  willing_to_relocate: boolean;
  preferred_work_extents: string[];
  preferred_engagement_types: string[];
};

export type ScreeningJob = {
  title: string | null;
  location: string | null;
  work_type: string | null;
  work_extent: string | null;
  engagement_type: string | null;
  description: string;
  description_complete: boolean;
};

export type InitialScreening = {
  status: ScreeningStatus;
  reasons: ScreeningReason[];
};

export type AiRequirement = {
  type:
    | "education"
    | "license"
    | "certification"
    | "language"
    | "experience"
    | "skill"
    | "other";
  level: "mandatory" | "preferred" | "context";
  label: string;
  evidence_quote: string;
  met: boolean | null;
  matched_evidence_refs: string[];
};

export type AiEvaluation = {
  id: string;
  score: number;
  reasoning: string;
  match_highlights: string;
  concerns: string;
  requirements: AiRequirement[];
};

export type FinalEvaluation = {
  status: ScreeningStatus;
  reasons: ScreeningReason[];
  score: number;
  reasoning: string;
  match_highlights: string;
  concerns: string;
  requirements: AiRequirement[];
};

const REMOTE_RE =
  /\b(remote|fully remote|fjernarbeid|hjemmekontor|arbeid fra hvor som helst)\b/i;
const REPORTING_RE =
  /\b(report(?:s|ing)?(?: directly)? to|rapporterer(?: direkte)? til|reports directly to|underlagt|tett samarbeid med)\b/i;

const ROLE_EXPANSIONS: Record<string, string[]> = {
  coo: ["coo", "chief operating officer", "chief operations officer"],
  cpo: ["cpo", "chief product officer"],
  cco: ["cco", "chief commercial officer", "kommersiell leder"],
  ceo: ["ceo", "chief executive officer", "administrerende direktor"],
  cfo: ["cfo", "chief financial officer", "finansdirektor"],
  cto: ["cto", "chief technology officer", "teknologidirektor"],
  chro: ["chro", "chief human resources officer", "hr direktor"],
};

// Profilsidene lagrer ofte rollefamilier («Salg», «Produkt») fremfor konkrete
// titler. Listen under brukes kun mot stillingstittelen; at rollen nevnes i
// annonseteksten eller som rapporteringslinje er fortsatt ikke en rollematch.
const ROLE_FAMILY_TITLE_ALIASES: Record<string, string[]> = {
  salg: [
    "cco",
    "chief commercial officer",
    "kommersiell leder",
    "kommersielle leder",
    "commercial director",
    "commercial lead",
    "sales",
    "head of sales",
    "salgsdirektor",
    "salgssjef",
    "salgsleder",
    "business development",
    "forretningsutvikler",
    "forretningsutviklingsleder",
  ],
  produkt: [
    "produkt",
    "product",
    "cpo",
    "chief product officer",
    "product manager",
    "product owner",
    "produktleder",
    "produkteier",
    "produktdirektor",
  ],
  "utvikling tech": [
    "utvikler",
    "developer",
    "software engineer",
    "engineer",
    "tech lead",
    "cto",
    "chief technology officer",
    "teknologidirektor",
    "arkitekt",
    "devops",
    "data engineer",
  ],
  konsulent: ["konsulent", "consultant", "radgiver", "advisor"],
  markedsforing: [
    "marketing",
    "markedsforing",
    "cmo",
    "chief marketing officer",
    "growth",
  ],
  "hr people": ["hr", "human resources", "people", "recruiter", "rekrutterer", "talent"],
  finans: ["finans", "finance", "cfo", "chief financial officer", "controller", "okonomi"],
  operasjoner: [
    "operations",
    "coo",
    "chief operating officer",
    "operasjonsleder",
    "driftsleder",
  ],
  forskning: ["forskning", "forsker", "research", "researcher", "scientist"],
  "design ux": ["design", "designer", "ux", "ui", "product designer"],
  jus: ["jus", "jurist", "advokat", "legal", "lawyer", "legal counsel"],
};

const REGULATED_ROLE_RULES: Array<{
  code: string;
  title: RegExp;
  evidence: RegExp;
  label: string;
}> = [
  {
    code: "missing_legal_qualification",
    title:
      /\b(jurist|advokat|advokatfullmektig|legal counsel|lawyer|attorney)\b/i,
    evidence:
      /\b(rettsvitenskap|cand\.?\s*jur|juridisk (utdanning|embetseksamen)|law degree|master of laws?|ll\.?m|advokatbevilling)\b/i,
    label:
      "Stillingen krever juridisk utdanning eller kvalifikasjon som ikke er dokumentert",
  },
  {
    code: "missing_medical_authorization",
    title:
      /\b(lege|sykepleier|psykolog|fysioterapeut|farmasoyt|doctor|nurse|psychologist|physiotherapist|pharmacist)\b/i,
    evidence:
      /\b(autorisasjon|helsepersonell|medisin|sykepleie|psykologi|fysioterapi|farmasi|medical degree|nursing degree)\b/i,
    label:
      "Stillingen krever helsefaglig utdanning eller autorisasjon som ikke er dokumentert",
  },
];

export function normalizeScreeningText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9+#.]+/g, " ")
    .trim()
    .toLowerCase();
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(normalizeScreeningText).filter(Boolean))];
}

function roleAliases(targetRoles: string[]): string[] {
  const aliases = new Set<string>();
  for (const raw of targetRoles) {
    const role = normalizeScreeningText(raw);
    if (!role) continue;
    aliases.add(role);
    for (const [acronym, expansions] of Object.entries(ROLE_EXPANSIONS)) {
      const hasAcronym = new RegExp(`(^|\\s)${acronym}(\\s|$)`).test(role);
      const hasExpansion = expansions.some((item) => role.includes(item));
      if (!hasAcronym && !hasExpansion) continue;
      for (const expansion of expansions) aliases.add(expansion);
    }
    for (const familyAlias of ROLE_FAMILY_TITLE_ALIASES[role] ?? []) {
      aliases.add(familyAlias);
    }
  }
  return [...aliases];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Titler må treffes som hele ord/fraser. Vanlig substring ville f.eks. latt
// «production» utløse aliaset «product».
function titleContainsAlias(title: string, alias: string): boolean {
  if (!title || !alias) return false;
  const phrase = escapeRegex(alias).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|\\s)${phrase}(\\s|$)`, "i").test(title);
}

function containsPhrase(text: string, phrase: string): boolean {
  if (!text || !phrase) return false;
  if (/^[a-z0-9]{2,5}$/.test(phrase)) {
    return new RegExp(`(^|\\s)${phrase}(\\s|$)`, "i").test(text);
  }
  return text.includes(phrase);
}

function statusFromReasons(reasons: ScreeningReason[]): ScreeningStatus {
  if (reasons.some((reason) => reason.severity === "hard_filter")) {
    return "excluded";
  }
  if (reasons.some((reason) => reason.severity === "review")) {
    return "needs_review";
  }
  return "eligible";
}

function evidenceCorpus(evidence: EvidenceItem[]): string {
  return normalizeScreeningText(
    evidence.map((item) =>
      `${item.category} ${item.label} ${item.description ?? ""}`
    ).join(" "),
  );
}

export function initialScreening(
  job: ScreeningJob,
  profile: ScreeningProfile,
  evidence: EvidenceItem[],
): InitialScreening {
  const reasons: ScreeningReason[] = [];
  const title = normalizeScreeningText(job.title);
  const description = normalizeScreeningText(job.description);
  const location = normalizeScreeningText(job.location);
  const workType = normalizeScreeningText(job.work_type);

  const acceptedLocations = uniqueStrings([
    ...(profile.preferred_locations ?? []),
    profile.target_city,
    profile.target_region,
  ]);
  const remote = REMOTE_RE.test(`${workType} ${location} ${description}`);
  if (acceptedLocations.length > 0 && !profile.willing_to_relocate && !remote) {
    if (!location) {
      reasons.push({
        code: "location_missing",
        label:
          "Annonsen mangler lokasjon og må vurderes før den kan vises som relevant",
        severity: "review",
      });
    } else if (
      !acceptedLocations.some((accepted) =>
        containsPhrase(location, accepted) || containsPhrase(accepted, location)
      )
    ) {
      reasons.push({
        code: "location_outside_preference",
        label: "Lokasjonen er utenfor brukerens valgte område",
        severity: "hard_filter",
        evidence: job.location ?? undefined,
      });
    }
  }

  const aliases = roleAliases(profile.target_roles ?? []);
  if (aliases.length > 0) {
    const titleMatch = aliases.some((alias) => titleContainsAlias(title, alias));
    if (!titleMatch) {
      const reportingOnly = REPORTING_RE.test(description) &&
        aliases.some((alias) => titleContainsAlias(description, alias));
      reasons.push({
        code: reportingOnly
          ? "target_role_only_in_reporting_line"
          : "target_role_mismatch",
        label: reportingOnly
          ? "Målrollen nevnes bare som rapporteringslinje; stillingen er ikke selve målrollen"
          : "Stillingstittelen samsvarer ikke med brukerens målroller",
        severity: "hard_filter",
        evidence: job.title ?? undefined,
      });
    }
  }

  const documented = evidenceCorpus(evidence);
  for (const rule of REGULATED_ROLE_RULES) {
    rule.title.lastIndex = 0;
    if (!rule.title.test(title)) continue;
    rule.evidence.lastIndex = 0;
    if (!rule.evidence.test(documented)) {
      reasons.push({
        code: rule.code,
        label: rule.label,
        severity: "hard_filter",
        evidence: job.title ?? undefined,
      });
    }
  }

  if ((profile.preferred_work_extents ?? []).length > 0) {
    if (
      job.work_extent &&
      !profile.preferred_work_extents.includes(job.work_extent)
    ) {
      reasons.push({
        code: "work_extent_mismatch",
        label: "Stillingsomfanget samsvarer ikke med brukerens valg",
        severity: "hard_filter",
        evidence: job.work_extent,
      });
    }
  }

  if ((profile.preferred_engagement_types ?? []).length > 0) {
    if (
      job.engagement_type &&
      !profile.preferred_engagement_types.includes(job.engagement_type)
    ) {
      reasons.push({
        code: "engagement_type_mismatch",
        label: "Ansettelsesformen samsvarer ikke med brukerens valg",
        severity: "hard_filter",
        evidence: job.engagement_type,
      });
    }
  }

  if (!description || !job.description_complete) {
    reasons.push({
      code: "insufficient_job_text",
      label:
        "Full annonsetekst mangler; obligatoriske krav kan ikke kontrolleres",
      severity: "review",
    });
  }

  return { status: statusFromReasons(reasons), reasons };
}

function supportedQuote(description: string, quote: string): boolean {
  const haystack = normalizeScreeningText(description);
  const needle = normalizeScreeningText(quote);
  return needle.length >= 8 && haystack.includes(needle);
}

function cleanAiRequirements(
  raw: unknown,
  description: string,
  validEvidenceRefs: Set<string>,
): AiRequirement[] {
  if (!Array.isArray(raw)) return [];
  const allowedTypes = new Set([
    "education",
    "license",
    "certification",
    "language",
    "experience",
    "skill",
    "other",
  ]);
  const allowedLevels = new Set(["mandatory", "preferred", "context"]);
  const requirements: AiRequirement[] = [];
  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== "object") continue;
    const type = typeof item.type === "string" && allowedTypes.has(item.type)
      ? item.type
      : "other";
    const level =
      typeof item.level === "string" && allowedLevels.has(item.level)
        ? item.level
        : "context";
    const label = typeof item.label === "string"
      ? item.label.trim().slice(0, 240)
      : "";
    const evidenceQuote = typeof item.evidence_quote === "string"
      ? item.evidence_quote.trim().slice(0, 500)
      : "";
    if (!label || !supportedQuote(description, evidenceQuote)) continue;
    const met = typeof item.met === "boolean" ? item.met : null;
    const matchedEvidenceRefs = Array.isArray(item.matched_evidence_refs)
      ? item.matched_evidence_refs.filter((ref: unknown): ref is string =>
        typeof ref === "string" && validEvidenceRefs.has(ref)
      ).slice(0, 12)
      : [];
    requirements.push({
      type: type as AiRequirement["type"],
      level: level as AiRequirement["level"],
      label,
      evidence_quote: evidenceQuote,
      met,
      matched_evidence_refs: matchedEvidenceRefs,
    });
  }
  return requirements;
}

function text(value: unknown, max = 1000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function finalizeEvaluation(
  initial: InitialScreening,
  rawAi: unknown,
  description: string,
  evidence: EvidenceItem[],
): FinalEvaluation {
  const obj = rawAi && typeof rawAi === "object"
    ? rawAi as Record<string, unknown>
    : {};
  const validRefs = new Set(evidence.map((item) => item.ref));
  const requirements = cleanAiRequirements(
    obj.requirements,
    description,
    validRefs,
  );
  const reasons = [...initial.reasons];

  for (const requirement of requirements) {
    if (requirement.level !== "mandatory") continue;
    const met = requirement.matched_evidence_refs.length === 0
      ? false
      : requirement.met;
    if (met === false) {
      reasons.push({
        code: `mandatory_${requirement.type}_missing`,
        label: `Obligatorisk krav er ikke dokumentert: ${requirement.label}`,
        severity: "hard_filter",
        evidence: requirement.evidence_quote,
      });
    } else if (met === null) {
      reasons.push({
        code: `mandatory_${requirement.type}_unverified`,
        label: `Obligatorisk krav må verifiseres: ${requirement.label}`,
        severity: "review",
        evidence: requirement.evidence_quote,
      });
    }
  }

  const normalizedDescription = normalizeScreeningText(description);
  const descriptionHasExplicitQualification =
    /\b(ma ha|krever|required|must have|minimum)\b[\s\S]{0,180}\b(master(?:grad)?|bachelor(?:grad)?|utdanning|degree|autorisasjon|sertifisering|certification|license|licence)\b/i
      .test(normalizedDescription);
  const extractedMandatoryQualification = requirements.some((requirement) =>
    requirement.level === "mandatory" &&
    ["education", "license", "certification"].includes(requirement.type)
  );
  if (descriptionHasExplicitQualification && !extractedMandatoryQualification) {
    reasons.push({
      code: "mandatory_qualification_unparsed",
      label:
        "Annonsen ser ut til å ha et obligatorisk kvalifikasjonskrav som ikke ble sikkert tolket",
      severity: "review",
    });
  }

  let status = statusFromReasons(reasons);
  const rawScore = obj.score;
  if (
    status === "eligible" &&
    (typeof rawScore !== "number" || !Number.isFinite(rawScore))
  ) {
    reasons.push({
      code: "invalid_ai_score",
      label: "Scoringsmodellen returnerte ikke en gyldig score",
      severity: "review",
    });
    status = "needs_review";
  }

  return {
    status,
    reasons,
    score: status === "eligible"
      ? Math.max(0, Math.min(100, rawScore as number))
      : 0,
    reasoning: text(obj.reasoning),
    match_highlights: status === "eligible" ? text(obj.match_highlights) : "",
    concerns: text(obj.concerns),
    requirements,
  };
}
