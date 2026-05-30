// @ts-nocheck
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Json, Tables, TablesInsert } from "@/integrations/supabase/types";
import type { WhitespaceAnalysisResult } from "@/lib/whitespace-analysis";
import type { ShouldApplyResult } from "@/lib/should-apply";

export type MatchAssessmentRow = Tables<"match_assessments">;
export type MatchDimensionAssessmentRow = Tables<"match_dimension_assessments">;
export type PositioningRecommendationRow = Tables<"positioning_recommendations">;

export const matchAssessmentsQuery = (userId: string) =>
  queryOptions({
    queryKey: ["match-assessments", userId],
    staleTime: 30_000,
    queryFn: async (): Promise<MatchAssessmentRow[]> => {
      const { data, error } = await supabase
        .from("match_assessments")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MatchAssessmentRow[];
    },
  });

export const companyMatchAssessmentQuery = (userId: string, companyId: string) =>
  queryOptions({
    queryKey: ["match-assessments", "company", userId, companyId],
    staleTime: 30_000,
    enabled: !!userId && !!companyId,
    queryFn: async (): Promise<MatchAssessmentRow[]> => {
      const { data, error } = await supabase
        .from("match_assessments")
        .select("*")
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as MatchAssessmentRow[];
    },
  });

export const opportunityMatchAssessmentQuery = (userId: string, opportunityId: string) =>
  queryOptions({
    queryKey: ["match-assessments", "opportunity", userId, opportunityId],
    staleTime: 30_000,
    enabled: !!userId && !!opportunityId,
    queryFn: async (): Promise<MatchAssessmentRow[]> => {
      const { data, error } = await supabase
        .from("match_assessments")
        .select("*")
        .eq("user_id", userId)
        .eq("opportunity_id", opportunityId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as MatchAssessmentRow[];
    },
  });

export const positioningRecommendationsQuery = (userId: string) =>
  queryOptions({
    queryKey: ["positioning-recommendations", userId],
    staleTime: 30_000,
    queryFn: async (): Promise<PositioningRecommendationRow[]> => {
      const { data, error } = await supabase
        .from("positioning_recommendations")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PositioningRecommendationRow[];
    },
  });

export const dimensionAssessmentsQuery = (assessmentId: string) =>
  queryOptions({
    queryKey: ["match-dimension-assessments", assessmentId],
    staleTime: 30_000,
    enabled: !!assessmentId,
    queryFn: async (): Promise<MatchDimensionAssessmentRow[]> => {
      const { data, error } = await supabase
        .from("match_dimension_assessments")
        .select("*")
        .eq("assessment_id", assessmentId)
        .order("dimension", { ascending: true });
      if (error) throw error;
      return (data ?? []) as MatchDimensionAssessmentRow[];
    },
  });

export type PersistPreferencesDraftInput = {
  userId: string;
  assessmentType: TablesInsert<"match_assessments">["assessment_type"];
  white: WhitespaceAnalysisResult;
  shouldApply: ShouldApplyResult;
  companyId?: string | null;
  opportunityId?: string | null;
  listingId?: string | null;
};

/**
 * Persists a neutral «preferences profile» assessment (no employer/job context required).
 * Optional company/opportunity FKs for future flows.
 */
export async function persistPreferencesMatchDraft(input: PersistPreferencesDraftInput): Promise<{
  assessment: MatchAssessmentRow;
}> {
  const { userId, assessmentType, white, shouldApply, companyId, opportunityId, listingId } = input;

  const reasoning: Json = {
    module: "career_intelligence_3",
    primaryGap: shouldApply.primaryGap,
    confidence: shouldApply.confidence,
    whiteSpaceSummary: white.missingEvidence[0] ?? null,
    preferenceStoryMismatch: white.preferenceStoryMismatch,
  };

  const header: TablesInsert<"match_assessments"> = {
    user_id: userId,
    company_id: companyId ?? null,
    opportunity_id: opportunityId ?? null,
    listing_id: listingId ?? null,
    assessment_type: assessmentType,
    overall_match_score: shouldApply.apply_recommendation_score,
    evidence_strength_score: null,
    positioning_score: null,
    apply_recommendation_score: shouldApply.apply_recommendation_score,
    match_band: shouldApply.apply_recommendation_score >= 70 ? "strong" : shouldApply.apply_recommendation_score >= 40 ? "moderate" : "weak",
    summary: null,
    reasoning,
    recommendation_summary: shouldApply.missingInformation[0] ?? null,
    status: "draft",
    source: "system",
    generated_by: "preferences_mvp",
    generated_at: new Date().toISOString(),
    expires_at: null,
  };

  const { data: assessment, error: hErr } = await supabase.from("match_assessments").insert(header).select().single();
  if (hErr) throw hErr;
  const a = assessment as MatchAssessmentRow;

  const dimRows: TablesInsert<"match_dimension_assessments">[] = white.preferenceAlignment.map((row) => ({
    assessment_id: a.id,
    dimension: `preference:${String(row.dimension)}`,
    preference_alignment_score: row.alignmentScore1to6,
    evidence_strength_score: row.alignmentScore1to6,
    market_alignment_score: null,
    overall_dimension_score: row.alignmentScore1to6,
    score_band:
      row.alignmentScore1to6 == null
        ? null
        : row.alignmentScore1to6 <= 2
          ? "weak"
          : row.alignmentScore1to6 <= 4
            ? "moderate"
            : "strong",
    matched_preference_atoms: row.matchedPreferences.map((p) => ({ id: p.id, label: p.label })) as unknown as Json,
    matched_evidence_atoms: row.matchedEvidence.map((e) => ({ id: e.id, label: e.label })) as unknown as Json,
    missing_evidence_atoms: [] as unknown as Json,
    inferred_requirements: white.inferredRequirements.filter((r) => r.relatedDimension == null).map((r) => ({ id: r.id, text: r.text })) as unknown as Json,
    reasoning: null,
    recommendation: null,
  }));

  if (dimRows.length > 0) {
    const { error: dErr } = await supabase.from("match_dimension_assessments").insert(dimRows);
    if (dErr) throw dErr;
  }

  const posRows: TablesInsert<"positioning_recommendations">[] = white.positioningOpportunities.slice(0, 8).map((desc, i) => ({
    assessment_id: a.id,
    user_id: userId,
    category: "positioning",
    title: `Mulighet ${i + 1}`,
    description: desc,
    priority_score: 5,
    impact_score: 5,
    effort_score: 3,
    status: "open",
    generated_by: "preferences_mvp",
    source_dimension: null,
  }));

  if (posRows.length > 0) {
    const { error: pErr } = await supabase.from("positioning_recommendations").insert(posRows);
    if (pErr) throw pErr;
  }

  return { assessment: a };
}
