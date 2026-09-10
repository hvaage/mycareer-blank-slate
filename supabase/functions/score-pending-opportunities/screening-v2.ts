// Karriereontologi v4, fase 2.1: evidensgrunnlaget byttet fra user_evidence_atoms
// til career_atoms. Scoringer mot ulike grunnlag kan ikke sammenlignes.
// Fase 0 (jobb-leads v3): grunnlaget er strammet inn til user_confirmed=true.
// 2026-08-25: rolleporten forstår nå produktets rollefamilier (f.eks. Salg → CCO),
// ikke bare eksakte stillingstitler. Semantikken er endret, derfor ny versjon.
// 2026-08-25 (v6): full CxO-/forkortelsestaksonomi med norske motparter
// (CEO/«adm. dir.», CFO/«økonomisjef», CMO, CIO, CISO, CDO, CHRO, CRO, CSO,
// CGO, CLO, EVP/SVP/VP, PM/PO/EM/BA/QA/UX/UI/SRE/ML/AI/BI/CRM/ERP/SEO/SEM/
// BD/KAM/AE/AM/SDR/BDR/FoU). Familien «Prosjektledelse» manglet og er lagt inn.
// Normaliseringen translitterer nå æ/ø/å — tidligere ble «Markedsføring» til
// «markedsf ring» og traff aldri familienøkkelen, og «direktør»-aliaser var døde.
// 2026-09-10 (v8): kravvurdering skiller eksplisitt mellom oppfylt, uavklart og
// ikke oppfylt. Manglende evidens kan ikke lenger ekskludere.
export const MATCH_SCORE_VERSION = "job_match_v8_2026_09_10";
/** Forrige versjon. Rader med denne kan ha blandet manglende evidens og avslag. */
export const MATCH_SCORE_VERSION_LEGACY = "job_match_v7_2026_08_26";
/** Eldre versjon. Rader med denne er scoret før forkortelsestaksonomien. */
export const MATCH_SCORE_VERSION_LEGACY_V2 = "job_match_v6_2026_08_25";
/** Eldre versjon. Rader med denne er scoret før rollefamilie-taksonomien. */
export const MATCH_SCORE_VERSION_LEGACY_V3 = "job_match_v4_2026_08_23";

export type ScreeningStatus = "eligible" | "excluded" | "needs_review";
export type ScreeningSeverity = "hard_filter" | "review";
export type RequirementEvaluationStatus =
  | "SATISFIED"
  | "UNVERIFIED"
  | "NOT_SATISFIED";
export type EvidenceKind = "explicit" | "derived" | "inferred" | "unknown";
export type ComputedExperienceCategory =
  | "total"
  | "sales"
  | "technology"
  | "technology_sales"
  | "leadership"
  | "enterprise"
  | "saas_cloud"
  | "partner_channel"
  | "distributed_teams";

export type ComputedExperience = {
  category: ComputedExperienceCategory;
  months: number;
  years: number;
  source_refs: string[];
  evidence_kind: EvidenceKind;
  intervals: Array<{
    ref: string;
    label: string;
    start: string;
    end: string;
    evidence_kind: EvidenceKind;
  }>;
};

export type NormalizedRequirement = {
  modality: "mandatory" | "preferred" | "context";
  min_years: number | null;
  mentioned_years_upper: number | null;
  upper_is_max: boolean;
  allows_equivalent: boolean;
  experience_category: ComputedExperienceCategory | null;
};

export type ScreeningReason = {
  code: string;
  label: string;
  severity: ScreeningSeverity;
  evidence?: string;
  evaluation_status?: RequirementEvaluationStatus;
  requirement_level?: AiRequirement["level"];
  requirement_type?: AiRequirement["type"];
  matched_evidence_refs?: string[];
  evidence_kind?: EvidenceKind;
};

export type EvidenceItem = {
  ref: string;
  category: string;
  label: string;
  description?: string | null;
  atom_type?: string | null;
  parent_atom_id?: string | null;
  structured_data?: Record<string, unknown> | null;
  source_quote?: string | null;
  confidence?: string | null;
  attestation?: string | null;
  user_confirmed?: boolean | null;
  evidence_kind?: EvidenceKind;
  computed_experience?: ComputedExperience;
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
  evaluation_status: RequirementEvaluationStatus;
  matched_evidence_refs: string[];
  evidence_kind?: EvidenceKind;
  normalized?: NormalizedRequirement;
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
const SALES_RE =
  /\b(sales|salg\w*|selger|account|key account|commercial|kommersiell\w*|business development|revenue|gtm|go to market|presales|pre sales|customer success)\b/i;
const TECHNOLOGY_RE =
  /\b(technology|technolog\w*|teknolog\w*|tech|it|ikt|software|programvare|saas|cloud|sky\w*|cyber\w*|security|sikkerhet|digital\w*|data|platform|plattform|infrastruktur|network|nettverk|cisco|netapp|symantec|microsoft|aws|amazon web services|google cloud|oracle|sap|salesforce|vmware|dell|hewlett packard|hpe|ibm|servicenow|snowflake|red hat|palo alto|fortinet|juniper)\b/i;
const LEADERSHIP_RE =
  /\b(leder\w*|ledelse|ledet|leadership|manager|director|direktor|vp|vice president|chief|head of|team lead|people manager|managed|management|mentored|coached|personalansvar)\b/i;
const ENTERPRISE_RE =
  /\b(enterprise|strategic account|key account|major account|large account|global account|storbedrift\w*|konsern|b2b|fortune|large enterprise)\b/i;
const SAAS_CLOUD_RE =
  /\b(saas|cloud|sky\w*|azure|aws|amazon web services|gcp|google cloud|microsoft 365|software as a service|iaas|paas)\b/i;
const PARTNER_CHANNEL_RE =
  /\b(partner|channel|kanal\w*|distributor|distribusjon|distribution|reseller|forhandler|alliances?|allianse\w*|var)\b/i;
const DISTRIBUTED_TEAMS_RE =
  /\b(distributed|distribuert|remote teams?|fjernledelse|global team|globalt team|international team|internasjonalt team|matrix|matrise|cross functional|tverrfaglig|nordic team|nordisk team|emea)\b/i;
const EXPERIENCE_RE =
  /\b(experience|erfaring|background|bakgrunn|years?|yrs?|ar|aar)\b/i;
const UNSUPPORTED_SPECIFIC_DOMAIN_RE =
  /\b(public sector|offentlig sektor|government|statlig|kommunal|healthcare|helse|pharma|banking|bank|insurance|forsikring|retail|varehandel|manufacturing|industri)\b/i;

const EXPERIENCE_LABELS: Record<ComputedExperienceCategory, string> = {
  total: "total erfaring",
  sales: "salgserfaring",
  technology: "teknologibransje-erfaring",
  technology_sales: "teknologisalg",
  leadership: "ledererfaring",
  enterprise: "enterprise-erfaring",
  saas_cloud: "SaaS/cloud-erfaring",
  partner_channel: "partner- og kanalerfaring",
  distributed_teams: "erfaring med distribuerte team",
};

// CxO- og tittelforkortelser: hver gruppe samler forkortelsen, engelske
// fullformer og norske motparter. Gruppene virker begge veier — både når
// brukeren skriver forkortelsen som målrolle og når annonsen bruker den.
// VIKTIG: alle strenger må være i normalisert form (små bokstaver, æ→ae,
// ø→o, å→a), fordi de legges til som aliaser uten ny normalisering.
// cpo/cso/cdo er flertydige i markedet (product/people/procurement osv.);
// porten er bevisst raus — presisjonen ivaretas av KI-scoringen etterpå.
const ROLE_EXPANSIONS: Record<string, string[]> = {
  // — C-suite —
  ceo: [
    "ceo",
    "chief executive officer",
    "administrerende direktor",
    "adm dir",
    "daglig leder",
    "managing director",
  ],
  cfo: [
    "cfo",
    "chief financial officer",
    "finansdirektor",
    "finanssjef",
    "okonomidirektor",
    "okonomisjef",
  ],
  coo: [
    "coo",
    "chief operating officer",
    "chief operations officer",
    "driftsdirektor",
    "driftssjef",
    "operasjonsdirektor",
  ],
  cto: [
    "cto",
    "chief technology officer",
    "teknologidirektor",
    "teknologisjef",
    "teknisk direktor",
  ],
  cmo: [
    "cmo",
    "chief marketing officer",
    "markedsdirektor",
    "markedssjef",
    "markedsforingssjef",
  ],
  cpo: [
    "cpo",
    "chief product officer",
    "produktdirektor",
    "produktsjef",
    "chief people officer",
    "chief procurement officer",
  ],
  cco: [
    "cco",
    "chief commercial officer",
    "kommersiell leder",
    "kommersiell direktor",
    "chief compliance officer",
    "chief communications officer",
  ],
  cro: [
    "cro",
    "chief revenue officer",
    "inntektsdirektor",
    "chief risk officer",
    "risikodirektor",
  ],
  cio: ["cio", "chief information officer", "it direktor", "it sjef"],
  ciso: [
    "ciso",
    "chief information security officer",
    "informasjonssikkerhetsdirektor",
    "sikkerhetsdirektor",
  ],
  cdo: [
    "cdo",
    "chief data officer",
    "chief digital officer",
    "datadirektor",
    "digitaliseringsdirektor",
    "chief design officer",
  ],
  chro: [
    "chro",
    "chief human resources officer",
    "hr direktor",
    "personaldirektor",
    "personalsjef",
  ],
  cso: [
    "cso",
    "chief sales officer",
    "salgsdirektor",
    "chief strategy officer",
    "strategidirektor",
    "chief sustainability officer",
    "barekraftsdirektor",
  ],
  cgo: ["cgo", "chief growth officer", "vekstdirektor"],
  clo: [
    "clo",
    "chief legal officer",
    "general counsel",
    "juridisk direktor",
    "konsernadvokat",
  ],
  caio: ["caio", "chief ai officer", "chief artificial intelligence officer"],
  // — Direktør-/VP-nivå —
  evp: ["evp", "executive vice president", "konserndirektor"],
  svp: ["svp", "senior vice president"],
  vp: ["vp", "vice president", "visedirektor"],
  gm: ["gm", "general manager"],
  // — Ledelse og leveranse —
  em: ["em", "engineering manager", "utviklingssjef", "teknisk leder"],
  pm: [
    "pm",
    "project manager",
    "product manager",
    "prosjektleder",
    "produktleder",
  ],
  po: ["po", "product owner", "produkteier"],
  // — Fagroller —
  ba: ["ba", "business analyst", "forretningsanalytiker"],
  qa: ["qa", "quality assurance", "kvalitetssikring"],
  ux: ["ux", "user experience", "brukeropplevelse"],
  ui: ["ui", "user interface", "brukergrensesnitt"],
  sre: ["sre", "site reliability engineer"],
  ml: ["ml", "machine learning", "maskinlaring"],
  ai: ["ai", "artificial intelligence", "kunstig intelligens", "ki"],
  bi: ["bi", "business intelligence"],
  erp: ["erp", "enterprise resource planning"],
  crm: ["crm", "customer relationship management", "kunderelasjoner"],
  seo: ["seo", "search engine optimization", "sokemotoroptimalisering"],
  sem: ["sem", "search engine marketing", "sokemotormarkedsforing"],
  hr: ["hr", "human resources", "personalledelse"],
  pr: ["pr", "public relations"],
  bd: ["bd", "business development", "forretningsutvikling"],
  kam: ["kam", "key account manager", "nokkelkundeansvarlig"],
  ae: ["ae", "account executive"],
  am: ["am", "account manager", "kundeansvarlig"],
  sdr: ["sdr", "sales development representative"],
  bdr: ["bdr", "business development representative"],
  fou: ["fou", "forskning og utvikling", "research and development", "r d"],
};

// Profilsidene lagrer ofte rollefamilier («Salg», «Produkt») fremfor konkrete
// titler. Listen under brukes kun mot stillingstittelen; at rollen nevnes i
// annonseteksten eller som rapporteringslinje er fortsatt ikke en rollematch.
// Nøklene er de normaliserte rollevalgene fra profilen
// (src/lib/career-profile-ui-constants.ts). «Annet» har bevisst ingen aliaser.
const ROLE_FAMILY_TITLE_ALIASES: Record<string, string[]> = {
  salg: [
    "salg",
    "sales",
    "cco",
    "cro",
    "chief commercial officer",
    "chief revenue officer",
    "kommersiell leder",
    "kommersiell direktor",
    "commercial director",
    "commercial lead",
    "head of sales",
    "salgsdirektor",
    "salgssjef",
    "salgsleder",
    "salgskonsulent",
    "salgsrepresentant",
    "business development",
    "forretningsutvikler",
    "forretningsutviklingsleder",
    "bd",
    "kam",
    "key account manager",
    "am",
    "account manager",
    "ae",
    "account executive",
    "kundeansvarlig",
    "sdr",
    "bdr",
    "customer success",
    "kundesuksess",
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
    "produktsjef",
    "po",
    "pm",
  ],
  "utvikling tech": [
    "utvikler",
    "developer",
    "software engineer",
    "software developer",
    "engineer",
    "tech lead",
    "arkitekt",
    "devops",
    "data engineer",
    "cto",
    "cio",
    "ciso",
    "chief technology officer",
    "teknologidirektor",
    "em",
    "engineering manager",
    "sre",
    "qa",
    "ml",
    "ai",
    "frontend",
    "backend",
    "fullstack",
    "c++",
    "c#",
  ],
  prosjektledelse: [
    "prosjektledelse",
    "prosjektleder",
    "prosjektsjef",
    "project manager",
    "pm",
    "programleder",
    "program manager",
    "project lead",
    "scrum master",
    "leveranseleder",
    "delivery manager",
  ],
  konsulent: [
    "konsulent",
    "consultant",
    "radgiver",
    "advisor",
    "ba",
    "business analyst",
    "forretningsanalytiker",
  ],
  markedsforing: [
    "marketing",
    "markedsforing",
    "cmo",
    "chief marketing officer",
    "growth",
    "markedssjef",
    "markedsdirektor",
    "seo",
    "sem",
    "pr",
    "public relations",
    "kommunikasjonssjef",
    "kommunikasjonsradgiver",
    "performance marketing",
    "digital markedsforing",
    "innholdsprodusent",
    "content",
  ],
  "hr people": [
    "hr",
    "human resources",
    "people",
    "recruiter",
    "rekrutterer",
    "talent",
    "chro",
    "chief human resources officer",
    "hr direktor",
    "personaldirektor",
    "personalsjef",
    "personalleder",
    "hr sjef",
    "talent acquisition",
    "rekrutteringssjef",
  ],
  finans: [
    "finans",
    "finance",
    "cfo",
    "chief financial officer",
    "finansdirektor",
    "finanssjef",
    "controller",
    "okonomi",
    "okonomisjef",
    "okonomidirektor",
    "regnskapssjef",
    "regnskapsforer",
    "revisor",
    "revisjon",
    "bi",
    "business intelligence",
  ],
  operasjoner: [
    "operations",
    "coo",
    "chief operating officer",
    "operasjonsleder",
    "driftsleder",
    "driftssjef",
    "driftsdirektor",
    "logistikk",
    "supply chain",
  ],
  forskning: [
    "forskning",
    "forsker",
    "research",
    "researcher",
    "scientist",
    "fou",
    "r d",
    "research and development",
    "forskning og utvikling",
    "data scientist",
  ],
  "design ux": [
    "design",
    "designer",
    "ux",
    "ui",
    "product designer",
    "user experience",
    "brukeropplevelse",
    "user interface",
    "interaksjonsdesigner",
    "grafisk designer",
  ],
  jus: [
    "jus",
    "jurist",
    "advokat",
    "advokatfullmektig",
    "legal",
    "lawyer",
    "legal counsel",
    "clo",
    "chief legal officer",
    "general counsel",
    "juridisk radgiver",
    "konsernadvokat",
    "compliance",
  ],
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
    // æ/ø/å dekomponeres ikke av NFKD — uten translittering ble de til
    // orddeling («direktør» → «direkt r»), og norske aliaser traff aldri.
    .replace(/æ/g, "ae")
    .replace(/Æ/g, "AE")
    .replace(/ø/g, "o")
    .replace(/Ø/g, "O")
    .replace(/å/g, "a")
    .replace(/Å/g, "A")
    // Ordfinal punktum fjernes («Adm. dir.» → «adm dir»), mens punktum
    // inne i ord beholdes («node.js», «.net», «ph.d.»).
    .replace(/\.(?=\s|$)/g, "")
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
  // Orddeling tolererer både mellomrom og punktum, slik at aliaset
  // «adm dir» også treffer «Adm. dir.» (normaliseringen beholder punktum).
  const phrase = escapeRegex(alias).replace(/\s+/g, "[.\\s]+");
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
  if (
    reasons.some((reason) =>
      reason.severity === "hard_filter" &&
      reason.evaluation_status === "NOT_SATISFIED"
    )
  ) {
    return "excluded";
  }
  if (
    reasons.some((reason) =>
      reason.severity === "review" || reason.severity === "hard_filter"
    )
  ) {
    return "needs_review";
  }
  return "eligible";
}

function evidenceCorpus(evidence: EvidenceItem[]): string {
  return normalizeScreeningText(
    evidence.map((item) =>
      `${item.category} ${item.label} ${item.description ?? ""} ${
        item.source_quote ?? ""
      } ${JSON.stringify(item.structured_data ?? {})}`
    ).join(" "),
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function compactText(parts: unknown[]): string {
  return parts
    .filter((part): part is string =>
      typeof part === "string" && part.trim().length > 0
    )
    .map((part) => part.trim())
    .join(" ");
}

function evidenceKindFromAtom(item: EvidenceItem): EvidenceKind {
  if (item.evidence_kind) return item.evidence_kind;
  if (item.confidence === "inferred") return "inferred";
  if (
    item.user_confirmed === true ||
    item.confidence === "verified" ||
    item.confidence === "imported" ||
    item.attestation
  ) {
    return "explicit";
  }
  return "unknown";
}

function strongestEvidenceKind(values: EvidenceKind[]): EvidenceKind {
  if (values.length === 0) return "unknown";
  if (values.includes("unknown")) return "unknown";
  if (values.includes("inferred")) return "inferred";
  if (values.includes("derived")) return "derived";
  return "explicit";
}

function parseYearMonthIndex(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})(?:-(0?[1-9]|1[0-2]))?(?:-\d{2})?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : 1;
  if (!Number.isInteger(year) || year < 1950 || year > 2100) return null;
  return year * 12 + month - 1;
}

function monthIndexToYearMonth(index: number): string {
  const year = Math.floor(index / 12);
  const month = index % 12 + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function currentMonthExclusive(now: Date): number {
  return now.getFullYear() * 12 + now.getMonth() + 1;
}

function unionMonths(
  intervals: Array<{ start: number; end: number }>,
): number {
  const sorted = intervals
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let total = 0;
  let current: { start: number; end: number } | null = null;
  for (const interval of sorted) {
    if (!current) {
      current = { ...interval };
      continue;
    }
    if (interval.start <= current.end) {
      current.end = Math.max(current.end, interval.end);
      continue;
    }
    total += current.end - current.start;
    current = { ...interval };
  }
  if (current) total += current.end - current.start;
  return total;
}

function yearsFromMonths(months: number): number {
  return Math.round((months / 12) * 10) / 10;
}

function formatYears(months: number): string {
  const years = yearsFromMonths(months);
  return `${
    Number.isInteger(years) ? years : years.toFixed(1).replace(".", ",")
  } år`;
}

type RoleExperienceInterval = {
  ref: string;
  label: string;
  start: number;
  end: number;
  text: string;
  evidence_kind: EvidenceKind;
};

function addInterval(
  byCategory: Map<ComputedExperienceCategory, RoleExperienceInterval[]>,
  category: ComputedExperienceCategory,
  interval: RoleExperienceInterval,
): void {
  const list = byCategory.get(category) ?? [];
  list.push(interval);
  byCategory.set(category, list);
}

function hasTechnologySignal(text: string): boolean {
  return TECHNOLOGY_RE.test(text);
}

function hasSalesSignal(text: string): boolean {
  return SALES_RE.test(text);
}

function classifyRoleCategories(
  text: string,
  sd: Record<string, unknown>,
): ComputedExperienceCategory[] {
  const categories: ComputedExperienceCategory[] = ["total"];
  const isSales = hasSalesSignal(text);
  const isTechnology = hasTechnologySignal(text);
  const employerSize = normalizeScreeningText(sd.employer_size);

  if (isSales) categories.push("sales");
  if (isTechnology) categories.push("technology");
  if (isSales && isTechnology) categories.push("technology_sales");
  if (LEADERSHIP_RE.test(text)) categories.push("leadership");
  if (
    ENTERPRISE_RE.test(text) || employerSize === "enterprise" ||
    employerSize === "large"
  ) {
    categories.push("enterprise");
  }
  if (SAAS_CLOUD_RE.test(text)) categories.push("saas_cloud");
  if (PARTNER_CHANNEL_RE.test(text)) categories.push("partner_channel");
  if (DISTRIBUTED_TEAMS_RE.test(text)) categories.push("distributed_teams");
  return [...new Set(categories)];
}

export function buildCalculatedExperienceEvidence(
  evidence: EvidenceItem[],
  options: { now?: Date } = {},
): EvidenceItem[] {
  const now = options.now ?? new Date();
  const endForCurrent = currentMonthExclusive(now);
  const childTextByParent = new Map<string, string[]>();
  for (const item of evidence) {
    if (!item.parent_atom_id) continue;
    const values = childTextByParent.get(item.parent_atom_id) ?? [];
    values.push(compactText([
      item.category,
      item.label,
      item.description,
      item.source_quote,
      JSON.stringify(item.structured_data ?? {}),
    ]));
    childTextByParent.set(item.parent_atom_id, values);
  }

  const byCategory = new Map<
    ComputedExperienceCategory,
    RoleExperienceInterval[]
  >();
  for (const item of evidence) {
    const sd = asRecord(item.structured_data);
    const looksLikeRole = item.atom_type === "role" ||
      (typeof sd.title === "string" && typeof sd.employer === "string");
    if (!looksLikeRole) continue;
    const start = parseYearMonthIndex(sd.start_date);
    if (start === null) continue;
    const rawEnd = parseYearMonthIndex(sd.end_date);
    const end = rawEnd === null || sd.is_current === true
      ? endForCurrent
      : rawEnd + 1;
    if (end <= start) continue;
    const roleId = item.ref.startsWith("ca:") ? item.ref.slice(3) : item.ref;
    const childText = childTextByParent.get(roleId) ?? [];
    const roleText = normalizeScreeningText(compactText([
      item.category,
      item.label,
      item.description,
      item.source_quote,
      sd.title,
      sd.employer,
      sd.industry,
      sd.employer_size,
      sd.employer_description,
      ...childText,
    ]));
    const label =
      compactText([sd.title, sd.employer ? `hos ${sd.employer}` : null]) ||
      item.label;
    const interval: RoleExperienceInterval = {
      ref: item.ref,
      label,
      start,
      end,
      text: roleText,
      evidence_kind: evidenceKindFromAtom(item),
    };
    for (const category of classifyRoleCategories(roleText, sd)) {
      addInterval(byCategory, category, interval);
    }
  }

  const result: EvidenceItem[] = [];
  for (const [category, intervals] of byCategory.entries()) {
    const months = unionMonths(intervals);
    if (months <= 0) continue;
    const refs = [...new Set(intervals.map((item) => item.ref))];
    const sourceKinds = intervals.map((item) => item.evidence_kind);
    const computed: ComputedExperience = {
      category,
      months,
      years: yearsFromMonths(months),
      source_refs: refs,
      evidence_kind: strongestEvidenceKind(sourceKinds),
      intervals: intervals.slice(0, 12).map((item) => ({
        ref: item.ref,
        label: item.label,
        start: monthIndexToYearMonth(item.start),
        end: monthIndexToYearMonth(item.end - 1),
        evidence_kind: item.evidence_kind,
      })),
    };
    const periodText = computed.intervals
      .map((item) => `${item.label} ${item.start}-${item.end}`)
      .join("; ");
    result.push({
      ref: `derived:experience:${category}`,
      category: "experience",
      label: `Beregnet ${EXPERIENCE_LABELS[category]}: ${formatYears(months)}`,
      description:
        `Beregnet fra arbeidshistorikk uten dobbelttelling av overlappende perioder. Perioder: ${periodText}`,
      evidence_kind: "derived",
      computed_experience: computed,
    });
  }
  return result.sort((a, b) =>
    (b.computed_experience?.months ?? 0) -
    (a.computed_experience?.months ?? 0)
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
        evaluation_status: "UNVERIFIED",
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
        evaluation_status: "NOT_SATISFIED",
      });
    }
  }

  const aliases = roleAliases(profile.target_roles ?? []);
  if (aliases.length > 0) {
    const titleMatch = aliases.some((alias) =>
      titleContainsAlias(title, alias)
    );
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
        evaluation_status: "NOT_SATISFIED",
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
        severity: "review",
        evidence: job.title ?? undefined,
        evaluation_status: "UNVERIFIED",
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
        evaluation_status: "NOT_SATISFIED",
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
        evaluation_status: "NOT_SATISFIED",
      });
    }
  }

  if (!description || !job.description_complete) {
    reasons.push({
      code: "insufficient_job_text",
      label:
        "Full annonsetekst mangler; obligatoriske krav kan ikke kontrolleres",
      severity: "review",
      evaluation_status: "UNVERIFIED",
    });
  }

  return { status: statusFromReasons(reasons), reasons };
}

function supportedQuote(description: string, quote: string): boolean {
  const haystack = normalizeScreeningText(description);
  const needle = normalizeScreeningText(quote);
  return needle.length >= 8 && haystack.includes(needle);
}

type RequirementDraft = {
  type: AiRequirement["type"];
  level: AiRequirement["level"];
  label: string;
  evidence_quote: string;
  met: boolean | null;
  raw_status: RequirementEvaluationStatus | null;
  matched_evidence_refs: string[];
};

const ALLOWED_REQUIREMENT_TYPES = new Set([
  "education",
  "license",
  "certification",
  "language",
  "experience",
  "skill",
  "other",
]);
const ALLOWED_REQUIREMENT_LEVELS = new Set([
  "mandatory",
  "preferred",
  "context",
]);
const ALLOWED_EVALUATION_STATUSES = new Set([
  "SATISFIED",
  "UNVERIFIED",
  "NOT_SATISFIED",
]);
const PREFERRED_MARKER_RE =
  /\b(preferably|preferred|advantageous|ideally|nice to have|would be a plus|is a plus|bonus|onskelig|ønskelig|fordel|gjerne|ideelt)\b/i;
const MANDATORY_MARKER_RE =
  /\b(must have|must|required|requirement|minimum|at least|need to have|ma ha|må ha|krever|obligatorisk|skal ha|minst)\b/i;
const EQUIVALENT_RE =
  /\b(or equivalent|equivalent experience|equivalent combination|eller tilsvarende|tilsvarende erfaring|realkompetanse)\b/i;
const EXPLICIT_MAX_RE =
  /\b(max(?:imum)?|up to|no more than|not more than|hoyest|høyest|maks(?:imum)?|inntil)\b/i;
const ATOMIC_REQUIREMENT_RE =
  /\b(experience|erfaring|bachelor|master|degree|utdanning|certification|sertifisering|license|licence|autorisasjon|language|sprak|språk|leder|leadership|sales|salg|industry|bransje|security clearance|klarering)\b/i;
const NEGATIVE_EVIDENCE_RE =
  /\b(ikke|mangler|uten|har ikke|not|no|without|lacks|does not|do not|none)\b/i;

function cleanRequirementLabel(value: string): string {
  return value
    .replace(PREFERRED_MARKER_RE, "")
    .replace(MANDATORY_MARKER_RE, "")
    .replace(/^[\s,;:.\-–—]+|[\s,;:.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function normalizeRawRequirementText(value: string): string {
  return value
    .replace(/[æÆ]/g, "ae")
    .replace(/[øØ]/g, "o")
    .replace(/[åÅ]/g, "a")
    .toLowerCase();
}

function parseEvaluationStatus(
  value: unknown,
): RequirementEvaluationStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return ALLOWED_EVALUATION_STATUSES.has(normalized)
    ? normalized as RequirementEvaluationStatus
    : null;
}

function normalizeRequirementLevel(
  rawLevel: AiRequirement["level"],
  textValue: string,
): AiRequirement["level"] {
  if (PREFERRED_MARKER_RE.test(textValue)) return "preferred";
  if (MANDATORY_MARKER_RE.test(textValue)) return "mandatory";
  return rawLevel;
}

function inferRequirementType(
  fallback: AiRequirement["type"],
  textValue: string,
): AiRequirement["type"] {
  const normalized = normalizeRawRequirementText(textValue);
  if (/\b(master|bachelor|degree|utdanning|education)\b/.test(normalized)) {
    return "education";
  }
  if (
    /\b(certification|certified|sertifisering|sertifikat)\b/.test(normalized)
  ) {
    return "certification";
  }
  if (/\b(license|licence|autorisasjon|forerkort|driver)\b/.test(normalized)) {
    return "license";
  }
  if (
    /\b(language|sprak|norwegian|english|norsk|engelsk|svensk|dansk)\b/.test(
      normalized,
    )
  ) {
    return "language";
  }
  if (EXPERIENCE_RE.test(normalized)) return "experience";
  return fallback;
}

function parseNumber(value: string): number {
  return Number(value.replace(",", "."));
}

function parseExperienceYears(rawText: string): {
  min: number | null;
  upper: number | null;
  upperIsMax: boolean;
} {
  const textValue = normalizeRawRequirementText(rawText);
  const yearWord = String.raw`(?:years?|yrs?|år|ar|aar)`;
  const upperIsMax = EXPLICIT_MAX_RE.test(textValue);
  const explicitMax = textValue.match(
    new RegExp(
      String
        .raw`\b(?:max(?:imum)?|up to|no more than|not more than|hoyest|maks(?:imum)?|inntil)\s*(\d+(?:[,.]\d+)?)\s*${yearWord}\b`,
      "i",
    ),
  );
  if (explicitMax) {
    return {
      min: null,
      upper: parseNumber(explicitMax[1]),
      upperIsMax: true,
    };
  }
  const range = textValue.match(
    new RegExp(
      String
        .raw`\b(\d+(?:[,.]\d+)?)\s*(?:-|–|—|to|til)\s*(\d+(?:[,.]\d+)?)\+?\s*${yearWord}\b`,
      "i",
    ),
  );
  if (range) {
    return {
      min: parseNumber(range[1]),
      upper: parseNumber(range[2]),
      upperIsMax,
    };
  }
  const explicitMin = textValue.match(
    new RegExp(
      String
        .raw`\b(?:minimum|minst|at least|min\.?)\s*(\d+(?:[,.]\d+)?)\+?\s*${yearWord}\b`,
      "i",
    ),
  );
  if (explicitMin) {
    return { min: parseNumber(explicitMin[1]), upper: null, upperIsMax: false };
  }
  const plus = textValue.match(
    new RegExp(String.raw`\b(\d+(?:[,.]\d+)?)\s*\+\s*${yearWord}\b`, "i"),
  );
  if (plus) {
    return { min: parseNumber(plus[1]), upper: null, upperIsMax: false };
  }
  const plain = textValue.match(
    new RegExp(String.raw`\b(\d+(?:[,.]\d+)?)\s*${yearWord}\b`, "i"),
  );
  if (plain) {
    return { min: parseNumber(plain[1]), upper: null, upperIsMax: false };
  }
  return { min: null, upper: null, upperIsMax: false };
}

function inferExperienceCategory(
  textValue: string,
): ComputedExperienceCategory | null {
  const normalized = normalizeScreeningText(textValue);
  const mentionsExperience = EXPERIENCE_RE.test(normalized);
  const sales = hasSalesSignal(normalized);
  const technology = hasTechnologySignal(normalized);
  const supportedSpecificDomain = technology ||
    SAAS_CLOUD_RE.test(normalized) ||
    PARTNER_CHANNEL_RE.test(normalized) ||
    ENTERPRISE_RE.test(normalized) ||
    DISTRIBUTED_TEAMS_RE.test(normalized);
  if (
    UNSUPPORTED_SPECIFIC_DOMAIN_RE.test(normalized) && !supportedSpecificDomain
  ) {
    return null;
  }
  if (sales && SAAS_CLOUD_RE.test(normalized)) return "saas_cloud";
  if (sales && PARTNER_CHANNEL_RE.test(normalized)) return "partner_channel";
  if (sales && ENTERPRISE_RE.test(normalized)) return "enterprise";
  if (sales && technology) return "technology_sales";
  if (sales) return "sales";
  if (LEADERSHIP_RE.test(normalized)) return "leadership";
  if (SAAS_CLOUD_RE.test(normalized)) return "saas_cloud";
  if (PARTNER_CHANNEL_RE.test(normalized)) return "partner_channel";
  if (ENTERPRISE_RE.test(normalized)) return "enterprise";
  if (DISTRIBUTED_TEAMS_RE.test(normalized)) return "distributed_teams";
  if (technology && mentionsExperience) return "technology";
  if (mentionsExperience) return "total";
  return null;
}

function normalizeRequirement(
  level: AiRequirement["level"],
  label: string,
  evidenceQuote: string,
): NormalizedRequirement {
  const rawText = `${label} ${evidenceQuote}`;
  const years = parseExperienceYears(rawText);
  const textValue = normalizeRawRequirementText(rawText);
  return {
    modality: normalizeRequirementLevel(level, rawText),
    min_years: years.min,
    mentioned_years_upper: years.upper,
    upper_is_max: years.upperIsMax,
    allows_equivalent: EQUIVALENT_RE.test(textValue),
    experience_category: inferExperienceCategory(rawText),
  };
}

function splitDelimitedRequirement(
  draft: RequirementDraft,
): RequirementDraft[] {
  const parts = draft.evidence_quote
    .split(/\s*(?:;|\n|•|\u2022)\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 8);
  if (parts.length <= 1) return [draft];
  return parts.map((part) => ({
    ...draft,
    type: inferRequirementType(draft.type, part),
    level: normalizeRequirementLevel(draft.level, part),
    label: cleanRequirementLabel(part) || draft.label,
    evidence_quote: part.slice(0, 500),
  }));
}

function splitAndRequirement(draft: RequirementDraft): RequirementDraft[] {
  const parts = draft.evidence_quote
    .split(/\s+(?:and|og)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return [draft];
  if (
    !parts.every((part) => part.length >= 8 && ATOMIC_REQUIREMENT_RE.test(part))
  ) {
    return [draft];
  }
  return parts.map((part) => ({
    ...draft,
    type: inferRequirementType(draft.type, part),
    level: normalizeRequirementLevel(draft.level, part),
    label: cleanRequirementLabel(part) || draft.label,
    evidence_quote: part.slice(0, 500),
  }));
}

function splitPreferredRequirement(
  draft: RequirementDraft,
): RequirementDraft[] {
  if (draft.level !== "mandatory") return [draft];
  const match = draft.evidence_quote.match(PREFERRED_MARKER_RE);
  if (!match || match.index === undefined || match.index <= 0) return [draft];
  const before = draft.evidence_quote.slice(0, match.index)
    .replace(/[\s,;:.\-–—]+$/g, "")
    .trim();
  const after = draft.evidence_quote.slice(match.index).trim();
  if (before.length < 8 || after.length < 8) return [draft];

  const beforeNormalized = normalizeScreeningText(before);
  const afterNormalized = normalizeScreeningText(after);
  const afterClean = cleanRequirementLabel(after);
  const preferredLabel = hasSalesSignal(beforeNormalized) &&
      hasTechnologySignal(afterNormalized) &&
      !hasSalesSignal(afterNormalized)
    ? `Sales experience ${afterClean}`.replace(/\s+/g, " ").trim()
    : afterClean;

  return [
    {
      ...draft,
      type: inferRequirementType(draft.type, before),
      level: normalizeRequirementLevel(draft.level, before),
      label: cleanRequirementLabel(before) || draft.label,
      evidence_quote: before.slice(0, 500),
    },
    {
      ...draft,
      type: inferRequirementType(draft.type, preferredLabel || after),
      level: "preferred",
      label: preferredLabel || draft.label,
      evidence_quote: after.slice(0, 500),
    },
  ];
}

function atomizeRequirement(draft: RequirementDraft): RequirementDraft[] {
  const delimited = splitDelimitedRequirement(draft);
  const preferred = delimited.flatMap(splitPreferredRequirement);
  return preferred.flatMap(splitAndRequirement).slice(0, 24);
}

function evidenceKindForRefs(
  refs: string[],
  evidenceByRef: Map<string, EvidenceItem>,
): EvidenceKind {
  return strongestEvidenceKind(
    refs.map((ref) =>
      evidenceByRef.get(ref)?.evidence_kind ??
        evidenceKindFromAtom(
          evidenceByRef.get(ref) ?? {
            ref,
            category: "",
            label: "",
          },
        )
    ),
  );
}

function refsContainNegativeEvidence(
  refs: string[],
  evidenceByRef: Map<string, EvidenceItem>,
): boolean {
  return refs.some((ref) => {
    const item = evidenceByRef.get(ref);
    if (!item) return false;
    const textValue = normalizeRawRequirementText(compactText([
      item.category,
      item.label,
      item.description,
      item.source_quote,
      JSON.stringify(item.structured_data ?? {}),
    ]));
    return NEGATIVE_EVIDENCE_RE.test(textValue);
  });
}

function computedExperienceForCategory(
  category: ComputedExperienceCategory,
  evidence: EvidenceItem[],
): EvidenceItem | null {
  const candidates = evidence.filter((item) =>
    item.computed_experience?.category === category
  );
  return candidates.sort((a, b) =>
    (b.computed_experience?.months ?? 0) -
    (a.computed_experience?.months ?? 0)
  )[0] ?? null;
}

function evaluateRequirementStatus(
  draft: RequirementDraft,
  normalized: NormalizedRequirement,
  evidence: EvidenceItem[],
  evidenceByRef: Map<string, EvidenceItem>,
): {
  status: RequirementEvaluationStatus;
  refs: string[];
  evidence_kind: EvidenceKind;
} {
  const refs = [...draft.matched_evidence_refs];
  const category = draft.type === "experience"
    ? normalized.experience_category
    : null;
  if (category) {
    const item = computedExperienceForCategory(category, evidence);
    if (item?.computed_experience) {
      const months = item.computed_experience.months;
      if (
        normalized.upper_is_max &&
        normalized.mentioned_years_upper !== null &&
        months > normalized.mentioned_years_upper * 12
      ) {
        return {
          status: "NOT_SATISFIED",
          refs: [...new Set([...refs, item.ref])],
          evidence_kind: "derived",
        };
      }
      if (
        normalized.min_years === null ||
        months >= normalized.min_years * 12
      ) {
        return {
          status: "SATISFIED",
          refs: [...new Set([...refs, item.ref])],
          evidence_kind: "derived",
        };
      }
      return {
        status: "UNVERIFIED",
        refs: [...new Set([...refs, item.ref])],
        evidence_kind: "derived",
      };
    }
  }

  const rawStatus = draft.raw_status;
  if (rawStatus === "SATISFIED" && refs.length > 0) {
    return {
      status: "SATISFIED",
      refs,
      evidence_kind: evidenceKindForRefs(refs, evidenceByRef),
    };
  }
  if (rawStatus === "NOT_SATISFIED" && refs.length > 0) {
    if (!refsContainNegativeEvidence(refs, evidenceByRef)) {
      return {
        status: "UNVERIFIED",
        refs,
        evidence_kind: evidenceKindForRefs(refs, evidenceByRef),
      };
    }
    return {
      status: "NOT_SATISFIED",
      refs,
      evidence_kind: evidenceKindForRefs(refs, evidenceByRef),
    };
  }
  if (draft.met === true && refs.length > 0) {
    return {
      status: "SATISFIED",
      refs,
      evidence_kind: evidenceKindForRefs(refs, evidenceByRef),
    };
  }
  if (draft.met === false && refs.length > 0) {
    if (!refsContainNegativeEvidence(refs, evidenceByRef)) {
      return {
        status: "UNVERIFIED",
        refs,
        evidence_kind: evidenceKindForRefs(refs, evidenceByRef),
      };
    }
    return {
      status: "NOT_SATISFIED",
      refs,
      evidence_kind: evidenceKindForRefs(refs, evidenceByRef),
    };
  }
  return {
    status: "UNVERIFIED",
    refs,
    evidence_kind: refs.length > 0
      ? evidenceKindForRefs(refs, evidenceByRef)
      : "unknown",
  };
}

function metFromEvaluationStatus(
  status: RequirementEvaluationStatus,
): boolean | null {
  if (status === "SATISFIED") return true;
  if (status === "NOT_SATISFIED") return false;
  return null;
}

function cleanAiRequirements(
  raw: unknown,
  description: string,
  validEvidenceRefs: Set<string>,
  evidence: EvidenceItem[],
): AiRequirement[] {
  if (!Array.isArray(raw)) return [];
  const evidenceByRef = new Map(evidence.map((item) => [item.ref, item]));
  const requirements: AiRequirement[] = [];
  for (const item of raw.slice(0, 24)) {
    if (!item || typeof item !== "object") continue;
    const rawItem = item as Record<string, unknown>;
    const type = typeof rawItem.type === "string" &&
        ALLOWED_REQUIREMENT_TYPES.has(rawItem.type)
      ? rawItem.type
      : "other";
    const level = typeof rawItem.level === "string" &&
        ALLOWED_REQUIREMENT_LEVELS.has(rawItem.level)
      ? rawItem.level
      : "context";
    const label = typeof rawItem.label === "string"
      ? rawItem.label.trim().slice(0, 240)
      : "";
    const evidenceQuote = typeof rawItem.evidence_quote === "string"
      ? rawItem.evidence_quote.trim().slice(0, 500)
      : "";
    if (!label || !supportedQuote(description, evidenceQuote)) continue;
    const met = typeof rawItem.met === "boolean" ? rawItem.met : null;
    const matchedEvidenceRefs = Array.isArray(rawItem.matched_evidence_refs)
      ? rawItem.matched_evidence_refs.filter((ref: unknown): ref is string =>
        typeof ref === "string" && validEvidenceRefs.has(ref)
      ).slice(0, 12)
      : [];
    const draft: RequirementDraft = {
      type: type as AiRequirement["type"],
      level: level as AiRequirement["level"],
      label,
      evidence_quote: evidenceQuote,
      met,
      raw_status: parseEvaluationStatus(rawItem.evaluation_status),
      matched_evidence_refs: matchedEvidenceRefs,
    };
    for (const atom of atomizeRequirement(draft)) {
      if (!supportedQuote(description, atom.evidence_quote)) continue;
      const inferredType = inferRequirementType(
        atom.type,
        `${atom.label} ${atom.evidence_quote}`,
      );
      const normalized = normalizeRequirement(
        atom.level,
        atom.label,
        atom.evidence_quote,
      );
      const evaluated = evaluateRequirementStatus(
        { ...atom, type: inferredType },
        normalized,
        evidence,
        evidenceByRef,
      );
      requirements.push({
        type: inferredType,
        level: normalized.modality,
        label: atom.label,
        evidence_quote: atom.evidence_quote,
        met: metFromEvaluationStatus(evaluated.status),
        evaluation_status: evaluated.status,
        matched_evidence_refs: evaluated.refs.slice(0, 12),
        evidence_kind: evaluated.evidence_kind,
        normalized,
      });
    }
  }
  return requirements;
}

function text(value: unknown, max = 1000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function requirementContradictedByExperience(
  reason: ScreeningReason,
  evidence: EvidenceItem[],
): boolean {
  if (reason.requirement_type !== "experience") return false;
  const normalized = normalizeRequirement(
    reason.requirement_level ?? "mandatory",
    reason.label,
    reason.evidence ?? reason.label,
  );
  const category = normalized.experience_category;
  if (!category) return false;
  if (normalized.upper_is_max) return false;
  const item = computedExperienceForCategory(category, evidence);
  if (!item?.computed_experience) return false;
  if (normalized.min_years === null) return item.computed_experience.months > 0;
  return item.computed_experience.months >= normalized.min_years * 12;
}

function applyContradictionGuard(
  reasons: ScreeningReason[],
  evidence: EvidenceItem[],
): ScreeningReason[] {
  let blocked = false;
  const guarded = reasons.map((reason) => {
    if (
      reason.severity !== "hard_filter" ||
      reason.evaluation_status !== "NOT_SATISFIED"
    ) {
      return reason;
    }
    if (!requirementContradictedByExperience(reason, evidence)) return reason;
    blocked = true;
    return {
      ...reason,
      severity: "review" as ScreeningSeverity,
      evaluation_status: "UNVERIFIED" as RequirementEvaluationStatus,
      label: `Eksklusjonsgrunnlag må avklares: ${reason.label}`,
    };
  });
  if (!blocked) return guarded;
  guarded.push({
    code: "sanity_guard_blocked_exclusion",
    label:
      "Eksklusjon ble stoppet fordi annen kandidat-evidens peker på at kravet kan være oppfylt",
    severity: "review",
    evaluation_status: "UNVERIFIED",
    evidence_kind: "derived",
  });
  return guarded;
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
    evidence,
  );
  const reasons = [...initial.reasons];

  for (const requirement of requirements) {
    if (requirement.level !== "mandatory") continue;
    if (requirement.evaluation_status === "NOT_SATISFIED") {
      reasons.push({
        code: `mandatory_${requirement.type}_missing`,
        label: `Obligatorisk krav er ikke oppfylt: ${requirement.label}`,
        severity: "hard_filter",
        evidence: requirement.evidence_quote,
        evaluation_status: "NOT_SATISFIED",
        requirement_level: requirement.level,
        requirement_type: requirement.type,
        matched_evidence_refs: requirement.matched_evidence_refs,
        evidence_kind: requirement.evidence_kind,
      });
    } else if (requirement.evaluation_status === "UNVERIFIED") {
      reasons.push({
        code: `mandatory_${requirement.type}_unverified`,
        label: `Obligatorisk krav må verifiseres: ${requirement.label}`,
        severity: "review",
        evidence: requirement.evidence_quote,
        evaluation_status: "UNVERIFIED",
        requirement_level: requirement.level,
        requirement_type: requirement.type,
        matched_evidence_refs: requirement.matched_evidence_refs,
        evidence_kind: requirement.evidence_kind,
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
      evaluation_status: "UNVERIFIED",
    });
  }

  const finalReasons = applyContradictionGuard(reasons, evidence);
  let status = statusFromReasons(finalReasons);
  const rawScore = obj.score;
  if (
    status === "eligible" &&
    (typeof rawScore !== "number" || !Number.isFinite(rawScore))
  ) {
    finalReasons.push({
      code: "invalid_ai_score",
      label: "Scoringsmodellen returnerte ikke en gyldig score",
      severity: "review",
      evaluation_status: "UNVERIFIED",
    });
    status = "needs_review";
  }

  return {
    status,
    reasons: finalReasons,
    score: status === "eligible"
      ? Math.max(0, Math.min(100, rawScore as number))
      : 0,
    reasoning: text(obj.reasoning),
    match_highlights: status === "eligible" ? text(obj.match_highlights) : "",
    concerns: text(obj.concerns),
    requirements,
  };
}
