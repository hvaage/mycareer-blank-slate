/**
 * Deterministic target-side atom extraction (regex / keywords). No AI.
 */

import type { Tables } from "@/integrations/supabase/types";
import type { CompanyAtomRefreshInput } from "@/lib/company-atom-refresh-select";
import { stableAtomHash } from "@/lib/career-atom-refresh";
import { normalizeAtomText } from "@/lib/target-atoms";

export type JobListingExtractInput = Pick<
  Tables<"job_listings">,
  "id" | "title" | "employer" | "location" | "description" | "salary" | "salary_min" | "salary_max" | "salary_currency" | "raw_data"
>;

/** Same row shape as `COMPANY_ATOM_REFRESH_SELECT` / `refreshCompanyAtoms`. */
export type CompanyExtractInput = CompanyAtomRefreshInput;

export type ExtractedRequirementAtom = {
  category: string;
  dimension: string | null;
  label: string;
  normalized_value: string | null;
  description: string | null;
  importance_score: number | null;
  confidence_score: number | null;
  source: string;
  source_field: string;
  inferred: boolean;
  source_hash: string;
};

export type ExtractedCompanyProfileAtom = {
  category: string;
  dimension: string | null;
  label: string;
  normalized_value: string | null;
  description: string | null;
  strength_score: number | null;
  confidence_score: number | null;
  source: string;
  source_field: string;
  inferred: boolean;
  source_hash: string;
};

export type ExtractedCompanySignalAtom = {
  signal_type: string;
  label: string;
  description: string | null;
  signal_strength: number | null;
  confidence_score: number | null;
  source: string;
  source_field: string;
  inferred: boolean;
  source_hash: string;
};

type KeywordRule = {
  re: RegExp;
  category: string;
  dimension: string | null;
  label: string;
  importance: number;
  source_field: string;
};

const JOB_KEYWORDS: KeywordRule[] = [
  { re: /\b(saas|software as a service|cloud[- ]?native)\b/i, category: "saas", dimension: "industry_match", label: "SaaS / produkt", importance: 5, source_field: "text:saas" },
  { re: /\b(enterprise|storbedrift|key account|kunder)\b/i, category: "enterprise_sales", dimension: "qualification_match", label: "Enterprise / storkunder", importance: 4, source_field: "text:enterprise" },
  { re: /\b(leder|manager|director|vp|head of|people lead|team lead)\b/i, category: "leadership", dimension: "leadership_match", label: "Ledelse", importance: 5, source_field: "text:leadership" },
  { re: /\b(p&l|resultatansvar|budsjettansvar|commercial)\b/i, category: "finance", dimension: "compensation_match", label: "Kommersielt / økonomi", importance: 4, source_field: "text:commercial_finance" },
  { re: /\b(transformasjon|transformation|change program)\b/i, category: "transformation", dimension: "growth_match", label: "Transformasjon", importance: 4, source_field: "text:transformation" },
  { re: /\b(remote|hybrid|hjemmekontor|distributed)\b/i, category: "remote_work", dimension: "flexibility_match", label: "Remote / hybrid", importance: 4, source_field: "text:remote" },
  { re: /\b(offentlig|kommune|statlig|public sector)\b/i, category: "public_sector", dimension: "industry_match", label: "Offentlig sektor", importance: 4, source_field: "text:public" },
  { re: /\b(drifts?|operations|supply chain|logistikk)\b/i, category: "operations", dimension: "qualification_match", label: "Drift / operasjoner", importance: 4, source_field: "text:operations" },
  { re: /\b(startup|scale-?up|tidlig fase|vekstfase)\b/i, category: "startup", dimension: "growth_match", label: "Startup / vekstfase", importance: 4, source_field: "text:startup" },
  { re: /\b(norsk|scandinavian|nordic language)\b/i, category: "norwegian_language", dimension: "qualification_match", label: "Norsk / skandinavisk språk", importance: 5, source_field: "text:language_no" },
  { re: /\b(kubernetes|aws|azure|backend|frontend|developer|engineer)\b/i, category: "technology", dimension: "qualification_match", label: "Teknologi / utvikling", importance: 4, source_field: "text:tech" },
  { re: /\b(strateg|strategy|corporate development)\b/i, category: "strategy", dimension: "strategic_value", label: "Strategi", importance: 4, source_field: "text:strategy" },
  { re: /\b(salg|sales|account executive|business development)\b/i, category: "sales", dimension: "qualification_match", label: "Salg", importance: 4, source_field: "text:sales" },
  { re: /\b(sikkerhet|security|cyber|iso\s*27001)\b/i, category: "security", dimension: "qualification_match", label: "Sikkerhet", importance: 4, source_field: "text:security" },
  { re: /\b(data|analytics|machine learning|ml\b|bi)\b/i, category: "data", dimension: "qualification_match", label: "Data / analyse", importance: 4, source_field: "text:data" },
  { re: /\b(hr|people partner|rekruttering|talent)\b/i, category: "people_management", dimension: "people", label: "HR / folk", importance: 4, source_field: "text:hr" },
];

function joinListingText(j: JobListingExtractInput): string {
  const bits = [j.title, j.employer, j.location, j.description, j.salary].filter(Boolean).join(" \n ");
  let extra = "";
  if (j.raw_data && typeof j.raw_data === "object") {
    try {
      const rd = j.raw_data as Record<string, unknown>;
      if (Array.isArray(rd.tags)) extra += " " + rd.tags.join(" ");
      if (typeof rd.keywords === "string") extra += " " + rd.keywords;
    } catch {
      /* ignore */
    }
  }
  return `${bits} ${extra}`;
}

export function extractOpportunityRequirementAtoms(listing: JobListingExtractInput): ExtractedRequirementAtom[] {
  const text = normalizeAtomText(joinListingText(listing));
  const seen = new Set<string>();
  const out: ExtractedRequirementAtom[] = [];

  for (const rule of JOB_KEYWORDS) {
    rule.re.lastIndex = 0;
    if (!rule.re.test(text)) continue;
    const key = `${rule.category}:${rule.source_field}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const source_hash = stableAtomHash(["opportunity_req", listing.id, rule.category, rule.label]);
    out.push({
      category: rule.category,
      dimension: rule.dimension,
      label: rule.label,
      normalized_value: rule.category,
      description: "Treff fra deterministisk nøkkelordanalyse av stillingstekst.",
      importance_score: rule.importance,
      confidence_score: 0.85,
      source: "system",
      source_field: rule.source_field,
      inferred: true,
      source_hash,
    });
  }

  if (listing.salary_min != null || listing.salary_max != null || (listing.salary && listing.salary.trim())) {
    const key = "compensation:salary_fields";
    if (!seen.has(key)) {
      seen.add(key);
      const sal = [listing.salary_min, listing.salary_max, listing.salary_currency, listing.salary].filter(Boolean).join(" ");
      const source_hash = stableAtomHash(["opportunity_req", listing.id, "compensation", sal]);
      out.push({
        category: "compensation",
        dimension: "compensation_match",
        label: "Lønnsinformasjon i annonsen",
        normalized_value: normalizeAtomText(sal) || "salary_present",
        description: "Annonsen inneholder lønnsfelt eller fritekst om kompensasjon.",
        importance_score: 4,
        confidence_score: 0.9,
        source: "system",
        source_field: "salary_fields",
        inferred: false,
        source_hash,
      });
    }
  }

  if (listing.location?.trim()) {
    const source_hash = stableAtomHash(["opportunity_req", listing.id, "location", listing.location]);
    out.push({
      category: "location",
      dimension: "flexibility_match",
      label: `Sted: ${listing.location.trim()}`,
      normalized_value: normalizeAtomText(listing.location),
      description: "Hentet fra annonsens lokasjonsfelt.",
      importance_score: 3,
      confidence_score: 1,
      source: "system",
      source_field: "location",
      inferred: false,
      source_hash,
    });
  }

  return out;
}

/** Set `true` locally to log corpus stats, rule groups, and confidence (dev only). */
export const DEBUG_TARGET_ATOMS = false;

/** Do not persist `company_profile_atoms` below this confidence (weak heuristics stay out of DB). */
export const MIN_PROFILE_CONFIDENCE_PERSIST = 0.65;

/** Do not persist `company_signal_atoms` below this confidence. */
export const MIN_SIGNAL_CONFIDENCE_PERSIST = 0.6;

export type CompanySizeBand = "unknown" | "smb" | "small" | "mid_market" | "enterprise";

function debugCompanyAtoms(phase: string, payload: Record<string, unknown>) {
  if (!DEBUG_TARGET_ATOMS || typeof console === "undefined" || !console.debug) return;
  console.debug("[target-atoms:company]", phase, payload);
}

function stringifyJsonFragment(v: unknown, max = 8000): string {
  if (v == null) return "";
  if (typeof v === "string") return v.slice(0, max);
  try {
    return JSON.stringify(v).slice(0, max);
  } catch {
    return "";
  }
}

/** Approximate headcount from free-text size_estimate (best-effort). */
function extractApproxHeadcount(text: string): number | null {
  const t = text.replace(/\u00a0/g, " ");
  const plusEmp = t.match(/\b(\d{1,9})\+\s*(employees|ansatte|medarbeidere|people)\b/i);
  if (plusEmp) {
    const n = parseInt(plusEmp[1], 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  const patterns: RegExp[] = [
    /\b(\d[\d\s,.]{0,12})\s*\+\s*(employees|ansatte|medarbeidere|people)\b/i,
    /\b(\d[\d\s,.]{0,12})\s*(employees|ansatte|medarbeidere|people|headcount|fte)\b/i,
    /\b(ca\.?|circa|~)\s*(\d{1,6})\b/i,
    /\b(\d{1,3}(?:[.,]\d{3})+)\s*(employees|ansatte)\b/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    const raw = (m[2] && /^\d/.test(m[2]) ? m[2] : m[1]) ?? m[1];
    const n = parseInt(String(raw).replace(/\D/g, ""), 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return null;
}

/**
 * Normalizes `size_estimate` into coarse bands for gating (SMB must not inherit global/enterprise heuristics).
 */
export function normalizeCompanySizeBand(size: string | null | undefined): CompanySizeBand {
  if (!size?.trim()) return "unknown";
  const raw = size.trim();
  const s = normalizeAtomText(raw);

  if (/\b(fortune(\s+500|\s+1000)?|global\s+corporation|multinational\s+(corporation|enterprise))\b/i.test(raw)) {
    return "enterprise";
  }

  const n = extractApproxHeadcount(raw + " " + s);
  if (n != null) {
    if (n >= 5000) return "enterprise";
    if (n >= 500) return "mid_market";
    if (n >= 50) return "small";
    return "smb";
  }

  if (/\b(10\s*000|5000|1000)\s*\+\b/i.test(s)) return "enterprise";
  if (/\b(mid[- ]market|mellomstor)\b/i.test(s)) return "mid_market";
  if (/\b(smb|småbedrift|micro\s+company|15\s*ansatte|under\s*20)\b/i.test(s)) return "smb";

  return "unknown";
}

export type KnownCompanyHint = {
  category: string;
  dimension: string | null;
  label: string;
  importance: number;
  source_field: string;
  confidence: number;
  inferred: boolean;
};

/**
 * Very small allowlist of obvious global / enterprise / engineering-heavy brands.
 * Transparent, conservative: only fires on normalized name match — never from generic prose alone.
 */
export function knownCompanyHints(name: string | null | undefined): KnownCompanyHint[] {
  if (!name?.trim()) return [];
  const n = normalizeAtomText(name);

  const megaTechIndustrial: { pattern: RegExp; key: string }[] = [
    { pattern: /\bsiemens\b/, key: "siemens" },
    { pattern: /\b(cisco|microsoft|sap|salesforce|oracle|ibm)\b/, key: "megatech" },
    { pattern: /\b(google|alphabet|amazon|apple|meta|facebook)\b/, key: "hyperscaler" },
    { pattern: /\b(nvidia|intel|amd|broadcom|qualcomm)\b/, key: "semiconductor" },
    { pattern: /\b(general electric|ge digital|honeywell|abb|schneider)\b/, key: "industrial" },
  ];

  for (const { pattern, key } of megaTechIndustrial) {
    if (!pattern.test(n)) continue;
    const base = `allowlist:${key}`;
    return [
      {
        category: "global_company",
        dimension: "industry_match",
        label: "Global virksomhet (kjent konsern)",
        importance: 5,
        source_field: `${base}:global`,
        confidence: 0.82,
        inferred: true,
      },
      {
        category: "enterprise_company",
        dimension: "industry_match",
        label: "Enterprise-skala (kjent konsern)",
        importance: 5,
        source_field: `${base}:enterprise`,
        confidence: 0.82,
        inferred: true,
      },
      {
        category: "engineering_culture",
        dimension: "culture_match",
        label: "Teknologi- og ingeniørkultur (kjent aktør)",
        importance: 5,
        source_field: `${base}:engineering`,
        confidence: 0.78,
        inferred: true,
      },
    ];
  }

  return [];
}

export function joinCompanyCorpus(c: CompanyExtractInput): string {
  return normalizeAtomText(
    [
      c.name,
      c.domain,
      c.country,
      c.description,
      c.ownership_type,
      c.industry,
      c.size_estimate,
      stringifyJsonFragment(c.ai_dimension_notes),
      stringifyJsonFragment(c.ai_rating_notes),
      stringifyJsonFragment(c.financials),
      stringifyJsonFragment(c.research_log),
    ].join(" \n "),
  );
}

const STRONG_GLOBAL = /\b(multinational\s+(corporation|company|group|enterprise)|worldwide\s+(operations|presence|footprint)|operations\s+in\s+\d{2,}\s+countries|presence\s+in\s+\d{2,}\s+countries)\b/i;

const ENTERPRISE_EXPLICIT =
  /\b(large\s+enterprise|global\s+corporation|fortune\s*\d+|listed\s+multinational|\d{4,}\+?\s*(employees|ansatte)|\d{1,2},\d{3}\+?\s*(employees|ansatte))\b/i;

const STRICT_TRANSFORMATION = /\b((digital|enterprise|business)\s+transformation\s+(program|initiative|agenda|journey)|large[- ]scale\s+transformation|company[- ]wide\s+transformation|transformasjonsprogram|turnaround\s+program)\b/i;

const STRICT_SUSTAINABILITY = /\b(esg\s+(strategy|report|program|framework)|net[- ]zero|carbon\s+neutral|decarboni(zation|ing)|climate\s+(transition|strategy|targets)|sustainability\s+(report|strategy|program)|csrd|double\s+materiality|taxonomy\s+aligned|energy\s+transition)\b/i;

const STRICT_PROCESS = /\b(formal\s+governance|enterprise\s+operating\s+model|heavy\s+reporting|three\s+lines\s+of\s+defense|internal\s+controls?\s+framework|iso\s*9001\s+certif|iso\s*14001\s+certif|regulatory\s+compliance\s+framework|risk\s+management\s+framework|public\s+sector\s+procurement\s+rules)\b/i;

const STRICT_GROWTH = /\b(series\s+[a-e]\b|scale[- ]?up|hypergrowth|rapid\s+growth|vekstselskap|skaleringsfase|venture[- ]capital|vc[- ]backed|aggressive\s+expansion|hiring\s+at\s+scale)\b/i;

const STRICT_ENGINEERING = /\b(engineering[- ]first|engineering[- ]led|r&d[- ]intensive|software[- ]intensive\s+(engineering|development)|industrial\s+automation\s+(systems|solutions))\b/i;

const STRICT_MATRIX = /\b(matrix\s+(organization|organisation|structure)|matriseorganisering)\b/i;

const STRICT_FLAT = /\b(flat\s+hierarchy|flat\s+structure|lavt\s+hierarki)\b/i;

const STRICT_MISSION = /\b(b[- ]corps?\b|bcorp|mission[- ]driven\s+organization)\b/i;

function pushProfile(
  out: ExtractedCompanyProfileAtom[],
  seen: Set<string>,
  companyId: string,
  spec: {
    category: string;
    dimension: string | null;
    label: string;
    normalized_value: string | null;
    description: string;
    strength: number;
    confidence: number;
    inferred: boolean;
    source_field: string;
  },
  debugRule: string,
  matchedPhrase?: string,
) {
  if (seen.has(spec.category)) return;
  seen.add(spec.category);
  const source_hash = stableAtomHash(["company_profile", companyId, spec.category, spec.source_field, spec.label]);
  out.push({
    category: spec.category,
    dimension: spec.dimension,
    label: spec.label,
    normalized_value: spec.normalized_value,
    description: spec.description,
    strength_score: spec.strength,
    confidence_score: spec.confidence,
    source: "system",
    source_field: spec.source_field,
    inferred: spec.inferred,
    source_hash,
  });
  debugCompanyAtoms("profile", {
    rule: debugRule,
    matchedPhrase: matchedPhrase ?? null,
    category: spec.category,
    confidence: spec.confidence,
    strength: spec.strength,
    inferred: spec.inferred,
  });
}

function collectCompanyProfileCandidates(company: CompanyExtractInput): ExtractedCompanyProfileAtom[] {
  const corpus = joinCompanyCorpus(company);
  const sizeBand = normalizeCompanySizeBand(company.size_estimate);
  const blocksHeuristicGlobalEnterprise = sizeBand === "smb" || sizeBand === "small";

  debugCompanyAtoms("corpus", { companyId: company.id, corpusLength: corpus.length, sizeBand });

  const seen = new Set<string>();
  const out: ExtractedCompanyProfileAtom[] = [];

  for (const h of knownCompanyHints(company.name)) {
    pushProfile(
      out,
      seen,
      company.id,
      {
        category: h.category,
        dimension: h.dimension,
        label: h.label,
        normalized_value: h.category,
        description: "Kjent selskapsnavn — konservativ forhåndsdefinisjon for matching.",
        strength: h.importance,
        confidence: h.confidence,
        inferred: h.inferred,
        source_field: h.source_field,
      },
      "allowlist",
      company.name ?? undefined,
    );
  }

  if (sizeBand !== "unknown") {
    const source_hash = stableAtomHash(["company_profile", company.id, "size_band", sizeBand]);
    out.push({
      category: "scaleup",
      dimension: "growth_match",
      label: `Størrelse (normalisert): ${sizeBand}`,
      normalized_value: sizeBand,
      description: "Normalisert fra `companies.size_estimate` (heuristikk).",
      strength_score: 3,
      confidence_score: 0.92,
      source: "system",
      source_field: "size_estimate:normalized",
      inferred: false,
      source_hash,
    });
    debugCompanyAtoms("profile", {
      rule: "size_band",
      category: "scaleup",
      confidence: 0.92,
      strength: 3,
      inferred: false,
      sizeBand,
    });
  }

  const missionScore = company.ai_mission_score;
  const missionNotesStrong =
    typeof missionScore === "number" &&
    !Number.isNaN(missionScore) &&
    missionScore >= 4.4 &&
    STRICT_SUSTAINABILITY.test(corpus);

  if (STRICT_SUSTAINABILITY.test(corpus) || missionNotesStrong) {
    const m = corpus.match(STRICT_SUSTAINABILITY);
    pushProfile(
      out,
      seen,
      company.id,
      {
        category: "sustainability_focus",
        dimension: "mission_match",
        label: "Bærekraft / ESG (eksplisitt)",
        normalized_value: "sustainability_focus",
        description: "Krever eksplisitt ESG-/klima-/rapporteringsspråk (eller svært høy misjonsscore + samme signal i notater).",
        strength: 4,
        confidence: missionNotesStrong ? 0.72 : 0.8,
        inferred: !missionNotesStrong,
        source_field: "corpus:sustainability_strict",
      },
      "sustainability_strict",
      m?.[0],
    );
  }

  if (STRICT_TRANSFORMATION.test(corpus)) {
    const m = corpus.match(STRICT_TRANSFORMATION);
    pushProfile(
      out,
      seen,
      company.id,
      {
        category: "transformation_heavy",
        dimension: "growth_match",
        label: "Transformasjonsintensiv (eksplisitt)",
        normalized_value: "transformation_heavy",
        description: "Krever eksplisitt transformasjonsprogram / stor endringsagenda — ikke generisk «endring».",
        strength: 4,
        confidence: 0.78,
        inferred: true,
        source_field: "corpus:transformation_strict",
      },
      "transformation_strict",
      m?.[0],
    );
  }

  if (!seen.has("global_company") && !blocksHeuristicGlobalEnterprise) {
    if (STRONG_GLOBAL.test(corpus) && (sizeBand === "mid_market" || sizeBand === "enterprise")) {
      const m = corpus.match(STRONG_GLOBAL);
      pushProfile(
        out,
        seen,
        company.id,
        {
          category: "global_company",
          dimension: "industry_match",
          label: "Global virksomhet (sterkt tekstbevis)",
          normalized_value: "global_company",
          description: "Krever multinasjonalt / worldwide footprint-språk — ikke «international» alene.",
          strength: 4,
          confidence: 0.74,
          inferred: true,
          source_field: "corpus:global_strong",
        },
        "global_strong",
        m?.[0],
      );
    }
  }

  if (!seen.has("enterprise_company") && !blocksHeuristicGlobalEnterprise) {
    if (sizeBand === "enterprise" || ENTERPRISE_EXPLICIT.test(corpus)) {
      const m = corpus.match(ENTERPRISE_EXPLICIT);
      pushProfile(
        out,
        seen,
        company.id,
        {
          category: "enterprise_company",
          dimension: "industry_match",
          label: "Enterprise-skala (sterkt tekstbevis / størrelse)",
          normalized_value: "enterprise_company",
          description: "Krever eksplisitt stor-skala-språk eller dokumentert veldig stor organisasjon.",
          strength: 4,
          confidence: sizeBand === "enterprise" ? 0.86 : 0.76,
          inferred: sizeBand !== "enterprise",
          source_field: sizeBand === "enterprise" ? "size:enterprise" : "corpus:enterprise_explicit",
        },
        "enterprise_explicit",
        m?.[0],
      );
    }
  }

  if (STRICT_GROWTH.test(corpus)) {
    const m = corpus.match(STRICT_GROWTH);
    pushProfile(
      out,
      seen,
      company.id,
      {
        category: "growth_company",
        dimension: "growth_match",
        label: "Vekstprofil (eksplisitt)",
        normalized_value: "growth_company",
        description: "Krever eksplisitt skalering, serie-finansiering eller dokumentert hypervekst — ikke generell ambisjon.",
        strength: 4,
        confidence: 0.7,
        inferred: true,
        source_field: "corpus:growth_strict",
      },
      "growth_strict",
      m?.[0],
    );
  }

  if (STRICT_PROCESS.test(corpus)) {
    const m = corpus.match(STRICT_PROCESS);
    pushProfile(
      out,
      seen,
      company.id,
      {
        category: "process_heavy",
        dimension: "culture_match",
        label: "Prosess og styring (eksplisitt)",
        normalized_value: "process_heavy",
        description: "Krever tung styringsspråk / sertifisering / rammeverk — ikke vanlig B2B-prosess.",
        strength: 3,
        confidence: 0.74,
        inferred: true,
        source_field: "corpus:process_strict",
      },
      "process_strict",
      m?.[0],
    );
  }

  if (STRICT_MATRIX.test(corpus)) {
    const m = corpus.match(STRICT_MATRIX);
    pushProfile(
      out,
      seen,
      company.id,
      {
        category: "matrix_organization",
        dimension: "culture_match",
        label: "Matriseorganisering (eksplisitt)",
        normalized_value: "matrix_organization",
        description: "Krever eksplisitt matrix / matrise — ikke bare «kompleks».",
        strength: 4,
        confidence: 0.76,
        inferred: true,
        source_field: "corpus:matrix",
      },
      "matrix",
      m?.[0],
    );
  }

  if (STRICT_FLAT.test(corpus)) {
    const m = corpus.match(STRICT_FLAT);
    pushProfile(
      out,
      seen,
      company.id,
      {
        category: "flat_structure",
        dimension: "culture_match",
        label: "Flat struktur (eksplisitt)",
        normalized_value: "flat_structure",
        description: "Krever eksplisitt flat struktur / lavt hierarki.",
        strength: 3,
        confidence: 0.74,
        inferred: true,
        source_field: "corpus:flat",
      },
      "flat",
      m?.[0],
    );
  }

  if (STRICT_MISSION.test(corpus)) {
    const m = corpus.match(STRICT_MISSION);
    pushProfile(
      out,
      seen,
      company.id,
      {
        category: "mission_driven",
        dimension: "mission_match",
        label: "Misjonsdrevet (eksplisitt)",
        normalized_value: "mission_driven",
        description: "Krever B Corp / mission-driven organisasjon — ikke generelt «formål».",
        strength: 4,
        confidence: 0.74,
        inferred: true,
        source_field: "corpus:mission_strict",
      },
      "mission_strict",
      m?.[0],
    );
  }

  if (!seen.has("engineering_culture") && STRICT_ENGINEERING.test(corpus)) {
    const m = corpus.match(STRICT_ENGINEERING);
    pushProfile(
      out,
      seen,
      company.id,
      {
        category: "engineering_culture",
        dimension: "culture_match",
        label: "Ingeniør- / teknologikultur (sterkt tekstbevis)",
        normalized_value: "engineering_culture",
        description: "Krever engineering-first / R&D-intensiv formulering — ikke enkelt «developer»-ord.",
        strength: 4,
        confidence: 0.72,
        inferred: true,
        source_field: "corpus:engineering_strict",
      },
      "engineering_strict",
      m?.[0],
    );
  }

  return out;
}

function collectCompanySignalCandidates(company: CompanyExtractInput): ExtractedCompanySignalAtom[] {
  const corpus = joinCompanyCorpus(company);
  const out: ExtractedCompanySignalAtom[] = [];
  const seen = new Set<string>();

  const tryPush = (
    signal_type: string,
    label: string,
    re: RegExp,
    strength: number,
    confidence: number,
    source_field: string,
  ) => {
    if (seen.has(signal_type)) return;
    re.lastIndex = 0;
    if (!re.test(corpus)) return;
    seen.add(signal_type);
    const m = corpus.match(re);
    const source_hash = stableAtomHash(["company_signal", company.id, signal_type, source_field]);
    out.push({
      signal_type,
      label,
      description: "Operativt signal fra tekstkorpus (konservativ heuristikk).",
      signal_strength: strength,
      confidence_score: confidence,
      source: "system",
      source_field,
      inferred: true,
      source_hash,
    });
    debugCompanyAtoms("signal", { rule: source_field, signal_type, confidence, strength, phrase: m?.[0] ?? null });
  };

  tryPush(
    "hiring_growth",
    "Økt rekruttering (eksplisitt)",
    /\b(we are hiring|now hiring|\d+\s+open\s+(roles|positions)|ledige stillinger|søker\s+\d+\s+nye)\b/i,
    4,
    0.66,
    "log:hiring_strict",
  );

  tryPush(
    "international_expansion",
    "Internasjonal ekspansjon (eksplisitt)",
    /\b(international\s+expansion|global\s+expansion|expansion\s+into\s+(multiple|several|new)\s+markets|entering\s+\d+\s+new\s+countries)\b/i,
    4,
    0.62,
    "log:expansion_strict",
  );

  tryPush(
    "transformation_program",
    "Transformasjonsprogram (eksplisitt)",
    /\b(transformation\s+program|transformasjonsprogram|enterprise[- ]wide\s+change\s+program)\b/i,
    4,
    0.64,
    "log:transform_program_strict",
  );

  tryPush(
    "sustainability_push",
    "Bærekraftssatsing (eksplisitt)",
    /\b(net[- ]zero\s+commitment|science[- ]based\s+targets|sustainability\s+roadmap|karbonnøytralitet\s+innen)\b/i,
    3,
    0.62,
    "log:sustainability_strict",
  );

  tryPush(
    "ai_initiative",
    "AI-satsing (eksplisitt)",
    /\b(genai\s+strategy|enterprise\s+llm|company[- ]wide\s+ai\s+initiative|ai\s+transformation\s+office)\b/i,
    4,
    0.63,
    "log:ai_strict",
  );

  tryPush(
    "restructuring",
    "Omorganisering (eksplisitt)",
    /\b(restructuring\s+program|workforce\s+reduction|plant\s+closure|spin[- ]off\s+announced)\b/i,
    4,
    0.62,
    "log:restructure_strict",
  );

  tryPush(
    "cost_focus",
    "Kostnadsprogram (eksplisitt)",
    /\b(cost\s+reduction\s+program|efficiency\s+program|overhead\s+cuts|zero[- ]based\s+budgeting\s+rollout)\b/i,
    3,
    0.6,
    "log:cost_strict",
  );

  tryPush(
    "new_product_push",
    "Produktsatsing (eksplisitt)",
    /\b(new\s+product\s+launch\s+roadmap|major\s+product\s+release\s+cycle|go[- ]to[- ]market\s+expansion)\b/i,
    4,
    0.61,
    "log:product_strict",
  );

  tryPush(
    "leadership_change",
    "Lederskifte (eksplisitt)",
    /\b(new\s+ceo\s+appointed|ceo\s+transition|chief\s+executive\s+change|ny\s+konsernsjef)\b/i,
    4,
    0.64,
    "log:leadership_strict",
  );

  return out;
}

export function extractCompanyProfileAtoms(company: CompanyExtractInput): ExtractedCompanyProfileAtom[] {
  const all = collectCompanyProfileCandidates(company);
  return all.filter((a) => (a.confidence_score ?? 0) >= MIN_PROFILE_CONFIDENCE_PERSIST);
}

export function extractCompanySignalAtoms(company: CompanyExtractInput): ExtractedCompanySignalAtom[] {
  const all = collectCompanySignalCandidates(company);
  return all.filter((a) => (a.confidence_score ?? 0) >= MIN_SIGNAL_CONFIDENCE_PERSIST);
}

/** Dev helper: full candidate lists vs persisted subsets (no DB). */
export function evaluateCompanyAtomExtraction(input: CompanyExtractInput) {
  const allProfile = collectCompanyProfileCandidates(input);
  const allSignals = collectCompanySignalCandidates(input);
  return {
    sizeBand: normalizeCompanySizeBand(input.size_estimate),
    corpusLength: joinCompanyCorpus(input).length,
    profilePersisted: allProfile.filter((a) => (a.confidence_score ?? 0) >= MIN_PROFILE_CONFIDENCE_PERSIST),
    profileDropped: allProfile.filter((a) => (a.confidence_score ?? 0) < MIN_PROFILE_CONFIDENCE_PERSIST),
    signalsPersisted: allSignals.filter((a) => (a.confidence_score ?? 0) >= MIN_SIGNAL_CONFIDENCE_PERSIST),
    signalsDropped: allSignals.filter((a) => (a.confidence_score ?? 0) < MIN_SIGNAL_CONFIDENCE_PERSIST),
  };
}

/** Example row: Siemens-like corpus (rich global / engineering / transformation / sustainability signals). */
export function exampleCompanyExtractSiemens(): CompanyExtractInput {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Siemens AG",
    domain: "siemens.com",
    industry: "Industrial technology",
    size_estimate: "300000+ employees worldwide",
    ownership_type: "Public",
    country: "DE",
    description: "Multinational technology corporation with worldwide operations.",
    ai_dimension_notes: null,
    ai_rating_notes: "Strong engineering culture; multinational footprint.",
    financials: null,
    research_log: [
      {
        note: "Enterprise-wide digital transformation program; sustainability roadmap with net-zero targets.",
      },
    ],
    ai_career_development_score: null,
    ai_culture_score: null,
    ai_financial_stability_score: null,
    ai_leadership_score: null,
    ai_mission_score: 4.5,
    ai_overall_score: null,
    ai_rated_at: null,
    ai_work_environment_score: null,
    created_at: null,
    updated_at: null,
  };
}

/** Example row: small German SMB — must not receive global/enterprise from weak prose. */
export function exampleCompanyExtractBember(): CompanyExtractInput {
  return {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Bember GmbH",
    domain: "bember.example",
    industry: "Software",
    size_estimate: "15 employees",
    ownership_type: "Private",
    country: "DE",
    description: "We build workflow tools for teams. International customers welcome.",
    ai_dimension_notes: null,
    ai_rating_notes: "Positive mission to help teams collaborate.",
    financials: null,
    research_log: [{ note: "Process-oriented delivery for B2B clients." }],
    ai_career_development_score: null,
    ai_culture_score: null,
    ai_financial_stability_score: null,
    ai_leadership_score: null,
    ai_mission_score: 3.5,
    ai_overall_score: null,
    ai_rated_at: null,
    ai_work_environment_score: null,
    created_at: null,
    updated_at: null,
  };
}
