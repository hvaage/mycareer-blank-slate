/**
 * RPC-wrapper for `public.get_employer_analysis_view`.
 *
 * Brukes både på offentlig rute (/arbeidsgivere/$orgnr) og innlogget rute
 * (/employers/$companyId). Samme datakontrakt; den eneste forskjellen er at
 * `weighting.personal` bare er populert når en innlogget bruker kaller RPC-en.
 *
 * `userKey` (typisk `auth.user?.id ?? "anon"`) inngår i queryKey slik at
 * personlig vekting ikke krysscaches mellom brukere/anonymt.
 */
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type EvidenceStatus =
  | "sourced"
  | "inferred"
  | "insufficient"
  | "insufficient_evidence"
  | string;

export type EmployerAnalysisDimensionKey =
  | "culture"
  | "leadership"
  | "work_environment"
  | "career_development"
  | "financial_stability"
  | "mission"
  | "talent_attraction_retention"
  | "diversity_inclusion";

export type AiSignalKey =
  | "strategy_and_leadership"
  | "capability_and_deployment"
  | "workforce"
  | "governance"
  | "market_and_product";

export type AnalysisDimension = {
  key: EmployerAnalysisDimensionKey | string;
  label: string;
  score: number | null;
  rationale: string | null;
  what_it_means: string | null;
  source_ids: number[] | null;
  evidence_status: EvidenceStatus | null;
};

export type AiSignal = {
  label: string;
  score: number | null;
  rationale: string | null;
  source_ids: number[] | null;
};

export type AiMaturity = {
  score: number | null;
  signals: Partial<Record<AiSignalKey, AiSignal>> | Record<string, AiSignal>;
  narrative: string | null;
  applicable: boolean | null;
  applicability_note: string | null;
  source_ids: number[] | null;
  key_evidence: unknown;
};

export type SupplementalInsight = {
  narrative: string | null;
  highlights: string[] | null;
  source_ids: number[] | null;
  evidence_status: EvidenceStatus | null;
  direction?: string | null;
};

export type AnalysisSource = {
  id: number;
  url: string;
  category: string | null;
};

export type EmployerAnalysisV2 = {
  overall: {
    score: number | null;
    total_dimensions: number;
    scored_dimensions: number;
  };
  executive_summary: string | null;
  key_findings: string[] | null;
  overall_assessment: string | null;
  dimensions: AnalysisDimension[];
  ai_maturity: AiMaturity | null;
  supplemental_insights: {
    esg_and_regulatory?: SupplementalInsight | null;
    employee_sentiment_trend?: SupplementalInsight | null;
    compensation_signals?: SupplementalInsight | null;
  } | null;
  sources: AnalysisSource[];
};

export type WeightingBlock = {
  score: number | null;
  total_dimensions: number;
  scored_dimensions: number;
  weight_coverage_percent: number | null;
};

export type WeightingEnvelope = {
  public: { employer: WeightingBlock; ai: WeightingBlock } | null;
  personal:
    | (WeightingEnvelope["public"] & { is_customized?: boolean | null })
    | null;
  admin_profile?: unknown;
};

export type FinancialsEnvelope = {
  currency: string | null;
  fiscal_year: number | null;
  revenue_latest: number | null;
  operating_result_latest: number | null;
  profit_latest: number | null;
  equity_latest: number | null;
  debt_latest: number | null;
  assets_latest: number | null;
  equity_ratio_percent: number | null;
  operating_margin_percent: number | null;
  source_kind: "brreg_local_mirror" | "official_web_fallback" | string | null;
  source_updated_at: string | null;
  history?: unknown[];
};

export type RegisterEnvelope = {
  entity?: {
    legal_name?: string | null;
    municipality?: string | null;
    postal_place?: string | null;
    county?: string | null;
    industry_primary?: string | null;
    organisation_form?: string | null;
    employee_count?: number | null;
    website?: string | null;
  } | null;
  sync?: unknown;
};

export type EmployerAnalysisViewEnvelope = {
  schema_version?: number | string;
  organisasjonsnummer: string;
  company: {
    id: string;
    name: string;
    industry?: string | null;
    analysis_version: number | null;
    analysis_rated_at: string | null;
    analysis_source_updated_at: string | null;
  };
  analysis: EmployerAnalysisV2 | null;
  register: RegisterEnvelope | null;
  financials: FinancialsEnvelope | null;
  weighting: WeightingEnvelope | null;
};

async function fetchEmployerAnalysisView(
  orgnr: string,
): Promise<EmployerAnalysisViewEnvelope | null> {
  const { data, error } = await supabase.rpc("get_employer_analysis_view" as never, {
    p_organisasjonsnummer: orgnr,
  } as never);
  if (error) throw error;
  if (!data) return null;
  return data as unknown as EmployerAnalysisViewEnvelope;
}

/**
 * `userKey` must be `useAuth().user?.id ?? "anon"`. Including it in the
 * queryKey isolates `weighting.personal` between users (and from anon).
 */
export function employerAnalysisViewQuery(
  orgnr: string | null | undefined,
  userKey: string,
) {
  return queryOptions({
    queryKey: ["employer-analysis-view", orgnr ?? null, userKey] as const,
    enabled: !!orgnr,
    staleTime: 30_000,
    queryFn: () => fetchEmployerAnalysisView(orgnr as string),
  });
}
