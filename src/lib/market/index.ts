// Re-export the dedicated market Supabase client under the local name `supabase`
// so that components copied verbatim from the sister project keep working
// without per-line refactoring.
export { marketSupabase as supabase } from "@/integrations/market-supabase/client";

export type EscoSearchResult = {
  uri: string;
  title_no: string | null;
  title_en: string | null;
  title?: string | null;
  esco_code?: string | null;
  entity_type?: string | null;
  score: number | null;
  industry_slugs?: string[] | null;
  industry_names?: string[] | null;
};

export type Industry = {
  slug: string;
  name_no: string;
  sort_order?: number | null;
};

// ===== Career Direction Explorer payload =====

export type DemandLevel = "high" | "medium" | "low" | "unknown" | string;

export type DemandComponent = {
  key: string;
  label: string;
  level: DemandLevel;
  value: number;
  source: string;
  description: string;
};

export type CompetencyItem = {
  uri: string;
  label: string;
  reason?: string | null;
  priority?: number | null;
  skill_type?: string | null;
};

export type LearnNext = {
  guidance?: string | null;
  start_with?: { uri: string; label: string }[];
  then_consider?: { uri: string; label: string }[];
};

export type IndustryMatch = {
  name: string;
  slug: string;
  source?: string;
  confidence?: number;
};

export type IndustryNationalSignal = {
  name: string;
  latest_year?: string | number | null;
  percent_change?: string | number | null;
  absolute_change?: string | number | null;
  employed_latest?: string | number | null;
  mapping_confidence?: string | number | null;
};

export type RegionSignal = {
  region_code: string;
  region_label: string;
  latest_year?: number | string | null;
  percent_change?: number | string | null;
  absolute_change?: number | string | null;
  employed_latest?: number | string | null;
  employed_previous?: number | string | null;
  relevance_score?: number | null;
  region_signal_score?: number | null;
  mapping_confidence?: number | null;
};

export type NearbyOccupation = {
  title: string;
  occupation_uri: string;
  overlap_count: number;
  overlap_score: number;
  overlap_index?: number | null;
  industry_names?: string[];
  shared_skills?: { title_no: string; skill_uri: string; relation_type: string }[];
  market_signal_score?: number | null;
  market_signal_level?: string | null;
  opportunity_score?: number | null;
  opportunity_level?: string | null;
  quadrant?: string | null;
  quadrant_label?: string | null;
  market_signal?: unknown;
  regional_signal?: {
    region_code?: string | null;
    region_label?: string | null;
  } | null;
};

export type OpportunityMatrixItem = {
  title: string;
  occupation_uri: string;
  overlap_index?: number | null;
  overlap_count?: number | null;
  market_signal_score?: number | null;
  market_signal_level?: string | null;
  opportunity_score?: number | null;
  opportunity_level?: string | null;
  quadrant?: string | null;
  quadrant_label?: string | null;
  regional_signal?: {
    region_code?: string | null;
    region_label?: string | null;
  } | null;
};

export type EmployerDemandSignal = {
  type?: string | null;
  label?: string | null;
  value?: number | null;
  high_intensity_value?: number | null;
  year?: number | string | null;
  scope?: string | null;
  group_type?: string | null;
  sample_base?: number | null;
  confidence?: number | null;
};

export type EmployerDemandField = {
  label: string;
  value?: number | null;
  score?: number | null;
};

export type EmployerDemand = {
  top_unmet_need_score?: number | null;
  signals?: EmployerDemandSignal[];
  competence_fields?: EmployerDemandField[];
};

export type CareerExplorerPayload = {
  found: boolean;
  query: string;
  message?: string | null;
  empty_state?: { title?: string; suggestion?: string } | null;
  filters?: { region_code: string | null; industry_slug: string | null };
  summary?: {
    title: string;
    description?: string | null;
    demand_label?: string;
    demand_level?: DemandLevel;
    demand_score?: number;
    key_insights?: string[];
    primary_industry?: { name: string; slug: string } | null;
  };
  demand?: {
    label?: string;
    level?: DemandLevel;
    score?: number;
    components?: DemandComponent[];
    employer_demand?: EmployerDemand;
  };
  competencies?: {
    must_have?: CompetencyItem[];
    nice_to_have?: CompetencyItem[];
    learn_next?: LearnNext;
    must_have_count?: number;
    nice_to_have_count?: number;
  };
  industries?: {
    matches?: IndustryMatch[];
    national_signals?: IndustryNationalSignal[];
  };
  geography?: { regions?: RegionSignal[] };
  nearby_occupations?: NearbyOccupation[];
  opportunity_matrix?: { items?: OpportunityMatrixItem[] } | null;
  visualization?: {
    opportunity_matrix?: { items?: OpportunityMatrixItem[] } | null;
  } | null;
  data_sources?: DataSource[];
  confidence_notes?: string[] | null;
};

// Legacy types kept for the original OccupationExplorer (no longer routed).
export type SkillRow = {
  relation_type: "essential" | "optional" | string;
  skill_type: string | null;
  skill: {
    uri: string;
    title_no: string | null;
    title_en: string | null;
    description_no: string | null;
    skill_type: string | null;
  } | null;
};

export type StyrkMapping = {
  styrk_code: string | null;
  styrk_title: string | null;
  mapping_relation: string | null;
  confidence: number | null;
};

// ===== Public market overview =====

export type IndustryTrendItem = {
  slug: string;
  name: string;
  latest_year?: number | string | null;
  employed_latest?: number | string | null;
  previous_year?: number | string | null;
  employed_previous?: number | string | null;
  absolute_change?: number | string | null;
  percent_change?: number | string | null;
  mapping_confidence?: number | string | null;
  source?: string | null;
};

export type RegionalSignalItem = {
  region_code: string;
  region_label: string;
  latest_year?: number | string | null;
  employed_latest?: number | string | null;
  previous_year?: number | string | null;
  employed_previous?: number | string | null;
  absolute_change?: number | string | null;
  percent_change?: number | string | null;
  region_signal_score?: number | null;
  source?: string | null;
};

export type CareerDirectionItem = {
  occupation_uri: string;
  title: string;
  market_signal_score?: number | null;
  market_signal_level?: string | null;
  direction_score?: number | null;
  latest_year?: number | string | null;
  employed_latest_thousands?: number | string | null;
  percent_change?: number | string | null;
  absolute_change_thousands?: number | string | null;
  context_percent_change?: number | string | null;
  context_absolute_change?: number | string | null;
  industries?: { slug?: string | null; name?: string | null }[] | null;
  regional_signal?: { region_code?: string | null; region_label?: string | null } | null;
  source?: string | null;
};

export type EmployerNeedItem = {
  type?: string | null;
  label?: string | null;
  value?: number | null;
  high_intensity_value?: number | null;
  level?: string | null;
  year?: number | string | null;
  scope?: string | null;
  industry_slug?: string | null;
  industry_name_no?: string | null;
  region_code?: string | null;
  region_label?: string | null;
  sample_base?: number | null;
  confidence?: number | null;
  source?: string | null;
  signal_change?: number | string | null;
  value_change?: number | string | null;
  signal_change_percent?: number | string | null;
};

export type CompetenceAreaItem = {
  uri: string;
  label: string;
  occupation_count?: number | null;
  weight?: number | null;
  source?: string | null;
  context?: string | null;
};

export type SuggestedExploration = {
  type?: string | null;
  title?: string | null;
  description?: string | null;
  action_label?: string | null;
};

export type DataSource = {
  provider?: string | null;
  name?: string | null;
  title?: string | null;
  source?: string | null;
  version?: string | null;
  imported_at?: string | null;
  description?: string | null;
  url?: string | null;
  source_url?: string | null;
  metadata?: Record<string, unknown> | null;
};

/** Heading per stabilisert payload: title → name → provider → "Datakilde". */
export function resolveDataSourceHeading(s: DataSource): string {
  return s.title ?? s.name ?? s.provider ?? "Datakilde";
}

/** Body: description → metadata.use → "". */
export function resolveDataSourceBody(s: DataSource): string {
  if (s.description) return s.description;
  const use = s.metadata?.use;
  if (typeof use === "string") return use;
  return "";
}

/** Skjul kort hvis heading er "Datakilde" og body er tom. */
export function shouldRenderDataSource(s: DataSource): boolean {
  const heading = resolveDataSourceHeading(s);
  const body = resolveDataSourceBody(s);
  return !(heading === "Datakilde" && body.length === 0);
}

/** Slå sammen og dedupliser datakilder fra flere RPC-payloads. */
export function mergeDataSources(
  ...lists: (DataSource[] | null | undefined)[]
): DataSource[] {
  const out: DataSource[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    if (!list) continue;
    for (const s of list) {
      const key = `${s.provider ?? ""}|${s.name ?? ""}|${s.title ?? ""}|${s.source_url ?? s.url ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

/** Statiske fallback-kilder. Brukes kun når ingen RPC leverte data_sources. */
export const FALLBACK_DATA_SOURCES: DataSource[] = [
  {
    provider: "ESCO",
    name: "ESCO",
    description:
      "EUs åpne klassifikasjon for yrker, kompetanser og kvalifikasjoner. Brukt som kompetansegrunnlag for må-ha-kompetanser og kompetanser som kan styrke profilen.",
  },
  {
    provider: "STYRK-08 / EURES",
    name: "STYRK-08 / EURES",
    description:
      "Norsk yrkesklassifisering. Koblinger via STYRK/EURES gjør norske stillingstitler lettere å matche mot ESCO-yrker.",
  },
  {
    provider: "SSB",
    name: "Statistisk sentralbyrå (SSB)",
    description:
      "Markedssignaler basert på sysselsetting, yrkesgrupper, bransjer, utdanningsfelt og regionale mønstre. Indikatorer, ikke prognoser.",
  },
  {
    provider: "NHO",
    name: "NHO Kompetansebarometeret",
    description:
      "Arbeidsgiveres rapporterte kompetansebehov, blant annet udekket kompetansebehov og etterspurte fagområder. Aggregerte signaler.",
  },
  {
    provider: "NAV",
    name: "NAV Bedriftsundersøkelsen",
    description: "Indikator for estimert mangel på arbeidskraft per yrke.",
  },
  {
    provider: "NAV",
    name: "NAV helt ledige",
    description:
      "Registrerte helt ledige per yrke. Indikator for tilgang på arbeidskraft.",
  },
  {
    provider: "NAV",
    name: "NAV ledige stillinger",
    description: "Tilgang ledige stillinger per yrke. Indikator for etterspørsel.",
  },
  {
    provider: "SSB",
    name: "SSB lønnsstatistikk",
    description:
      "Yrkesfordelt månedslønn brukes til å vise median månedslønn per yrke, samlet og etter sektor.",
  },
];

export type MarketOverviewPayload = {
  summary?: {
    title?: string | null;
    description?: string | null;
    filter_region_label?: string | null;
    filter_industry_name?: string | null;
  } | null;
  employer_needs?: {
    signals?: EmployerNeedItem[];
    unmet_need?: EmployerNeedItem[];
    competence_fields?: EmployerNeedItem[];
    education_levels?: EmployerNeedItem[];
    strongest_signals?: EmployerNeedItem[];
    weakest_signals?: EmployerNeedItem[];
    largest_increases?: EmployerNeedItem[];
    largest_decreases?: EmployerNeedItem[];
    trend_available?: boolean;
  } | null;
  industry_trends?: {
    items?: IndustryTrendItem[];
    growth_leaders?: IndustryTrendItem[];
    decline_leaders?: IndustryTrendItem[];
  } | null;
  regional_signals?: {
    items?: RegionalSignalItem[];
    growth_leaders?: RegionalSignalItem[];
    decline_leaders?: RegionalSignalItem[];
  } | null;
  career_directions?: {
    items?: CareerDirectionItem[];
    growth_leaders?: CareerDirectionItem[];
    decline_leaders?: CareerDirectionItem[];
  } | null;
  competence_areas?: {
    from_employer_needs?: CompetenceAreaItem[];
    sample_skills?: CompetenceAreaItem[];
  } | null;
  suggested_explorations?: SuggestedExploration[];
  data_sources?: DataSource[];
  confidence_notes?: string[] | null;
};

// ===== Industry skill signals (RPC: get_industry_skill_signals) =====

export type IndustrySkillExampleOccupation = {
  occupation_uri: string;
  title: string;
};

export type IndustrySkillSignalItem = {
  uri?: string | null;
  label: string;
  occupation_count?: number | null;
  total_occupations?: number | null;
  coverage_percent?: number | null;
  average_market_signal_score?: number | null;
  average_regional_signal_score?: number | null;
  example_occupations?: IndustrySkillExampleOccupation[] | null;
};

export type IndustrySkillSignalsPayload = {
  common_requirements?: IndustrySkillSignalItem[];
  less_common_requirements?: IndustrySkillSignalItem[];
  essential_requirements?: IndustrySkillSignalItem[];
  optional_requirements?: IndustrySkillSignalItem[];
  total_occupations?: number | null;
};


// ===== NAV + SSB market capacity =====

export type MarketCapacityStyrkSignal = {
  styrk_code: string | null;
  styrk_title: string | null;
  shortage_count: number | null;
  unemployed_count: number | null;
  vacancy_count: number | null;
  salary_median_all: number | null;
  salary_median_private: number | null;
  salary_median_state: number | null;
  salary_median_municipal: number | null;
};

export type MarketCapacityItem = {
  title: string | null;
  occupation_uri: string | null;
  shortage_count: number | null;
  unemployed_count: number | null;
  vacancy_count: number | null;
  shortage_to_unemployed_ratio: number | null;
  vacancy_to_unemployed_ratio: number | null;
  salary_median_all: number | null;
  salary_median_private: number | null;
  salary_median_state: number | null;
  salary_median_municipal: number | null;
  // Periodefelter er ikke garantert i RPC i dag.
  shortage_year?: number | string | null;
  unemployment_period?: string | null;
  vacancies_period?: string | null;
  salary_year?: number | string | null;
  styrk_market_signals?: MarketCapacityStyrkSignal[];
};

export type MarketCapacityRpcPayload = {
  found: boolean;
  schema_version?: string;
  items: MarketCapacityItem[];
  data_sources?: unknown[];
  confidence_notes?: string[];
};

export type StyrkMarketCapacityRow = {
  styrk_code: string | null;
  styrk_title: string | null;
  shortage_count: number | null;
  unemployed_count: number | null;
  vacancy_count: number | null;
  shortage_to_unemployed_ratio: number | null;
  vacancy_to_unemployed_ratio: number | null;
  salary_median_all: number | null;
  salary_median_private: number | null;
  salary_median_state: number | null;
  salary_median_municipal: number | null;
  salary_q1_all?: number | null;
  salary_q3_all?: number | null;
  salary_average_all?: number | null;
  shortage_year?: number | string | null;
  unemployment_period?: string | null;
  vacancies_period?: string | null;
  salary_year?: number | string | null;
  shortage_scope?: string | null;
  unemployment_scope?: string | null;
  vacancy_scope?: string | null;
  salary_scope?: string | null;
};

export type RegionalUnemploymentGroup = {
  label: string;
  value: number | string | null;
  period?: string | null;
  region_label?: string | null;
  region_code?: string | null;
};

export type MarketCapacityAppliedFilters = {
  is_filtered?: boolean;
  industry_slug?: string | null;
  industry_name?: string | null;
  region_code?: string | null;
  region_label?: string | null;
};

// ----- Helpers -----

/** True for any non-null/undefined value. 0 is valid. */
export function hasValue<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined;
}


// ===== Salary profile (RPC: get_public_salary_profile) =====

export type SalaryKpi = {
  code?: string | null;
  label?: string | null;
  year?: number | string | null;
  median_salary?: number | null;
  average_salary?: number | null;
  lower_quartile_salary?: number | null;
  upper_quartile_salary?: number | null;
  employment_count?: number | null;
};

export type SalarySeriesRow = {
  code?: string | null;
  label: string;
  year?: number | string | null;
  median_salary?: number | null;
  average_salary?: number | null;
  lower_quartile_salary?: number | null;
  upper_quartile_salary?: number | null;
  employment_count?: number | null;
  is_selected?: boolean;
};

export type SalaryProfileFilters = {
  industry_slug?: string | null;
  industry_name?: string | null;
  nace_code?: string | null;
  education_level?: string | null;
  age_group?: string | null;
  gender?: string | null;
  sector?: string | null;
  working_time?: string | null;
};

export type SalaryProfilePayload = {
  schema_version?: string;
  found?: boolean;
  filters?: SalaryProfileFilters | null;
  kpis?: {
    industry_median?: SalaryKpi | null;
    education_median?: SalaryKpi | null;
    age_median?: SalaryKpi | null;
  } | null;
  education_series?: SalarySeriesRow[];
  age_series?: SalarySeriesRow[];
  method_notes?: string[] | string | null;
  period?: string | null;
};




/** Format integer with norsk tusenskille. Returns fallback when value is null/undefined. */
export function formatNumberOrEmpty(
  v: number | null | undefined,
  fallback = "Ikke nok data",
): string {
  if (!hasValue(v) || Number.isNaN(v)) return fallback;
  return new Intl.NumberFormat("nb-NO").format(Math.round(v));
}

/** "57 830 kr/mnd" with non-breaking spaces. Returns "Ikke nok data" when null/undefined. */
export function formatSalaryKrPerMonth(
  v: number | null | undefined,
  fallback = "Ikke nok data",
): string {
  if (!hasValue(v) || Number.isNaN(v)) return fallback;
  const n = new Intl.NumberFormat("nb-NO").format(Math.round(v));
  return `${n.replace(/\s/g, "\u00a0")}\u00a0kr/mnd`;
}

export type MarketBalanceTone = "success" | "warning" | "muted";

export function marketBalanceLabel(
  ratio: number | null | undefined,
): { label: string; tone: MarketBalanceTone } {
  if (!hasValue(ratio) || Number.isNaN(ratio)) {
    return { label: "Ikke nok data", tone: "muted" };
  }
  if (ratio > 2) return { label: "Stramt marked", tone: "warning" };
  if (ratio >= 0.8) return { label: "Balansert", tone: "muted" };
  return { label: "Mer tilgjengelig kapasitet", tone: "success" };
}

/** Build period source line. Returns null if no period fields are present. */
export function formatPeriodLine(src: {
  shortage_year?: number | string | null;
  unemployment_period?: string | null;
  vacancies_period?: string | null;
  salary_year?: number | string | null;
}): string | null {
  const parts: string[] = [];
  if (hasValue(src.shortage_year))
    parts.push(`NAV Bedriftsundersøkelsen ${src.shortage_year}`);
  if (hasValue(src.unemployment_period))
    parts.push(`NAV ${src.unemployment_period}`);
  if (hasValue(src.vacancies_period))
    parts.push(`NAV ledige stillinger ${src.vacancies_period}`);
  if (hasValue(src.salary_year)) parts.push(`SSB lønn ${src.salary_year}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export type MarketCapacityOverviewSegment =
  | "shortage"
  | "unemployed"
  | "vacancies"
  | "tightness"
  | "salary";

export type MarketCapacityOverviewPayload = {
  found: boolean;
  segment: MarketCapacityOverviewSegment;
  segment_label?: string | null;
  summary?: { title?: string | null; description?: string | null } | null;
  source_periods?: Record<string, string | number | null> | null;
  source_line_parts?: (string | null)[] | null;
  items: StyrkMarketCapacityRow[];
  applied_filters?: MarketCapacityAppliedFilters | null;
  scope?: string | null;
  scope_note?: string | null;
  regional_unemployment_groups?: RegionalUnemploymentGroup[];
  data_sources?: unknown[];
  confidence_notes?: string[];
};




