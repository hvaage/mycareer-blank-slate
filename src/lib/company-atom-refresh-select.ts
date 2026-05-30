// @ts-nocheck
import type { Tables } from "@/integrations/supabase/types";

/**
 * Columns loaded for company target-atom refresh + client-side extraction.
 * Keep in sync with `public.companies` (see `Tables<"companies">`); PostgREST fails on unknown names.
 */
export const COMPANY_ATOM_REFRESH_COLUMNS = [
  "id",
  "name",
  "domain",
  "industry",
  "size_estimate",
  "ownership_type",
  "country",
  "description",
  "ai_dimension_notes",
  "ai_rating_notes",
  "financials",
  "research_log",
  "ai_career_development_score",
  "ai_culture_score",
  "ai_financial_stability_score",
  "ai_leadership_score",
  "ai_mission_score",
  "ai_overall_score",
  "ai_rated_at",
  "ai_work_environment_score",
  "created_at",
  "updated_at",
] as const satisfies readonly (keyof Tables<"companies">)[];

export const COMPANY_ATOM_REFRESH_SELECT = COMPANY_ATOM_REFRESH_COLUMNS.join(",");

export type CompanyAtomRefreshInput = Pick<
  Tables<"companies">,
  (typeof COMPANY_ATOM_REFRESH_COLUMNS)[number]
>;

/** Runtime guard: refresh response should include `id` (minimal sanity check). */
export function isCompanyAtomRefreshRow(v: unknown): v is CompanyAtomRefreshInput {
  return (
    typeof v === "object" &&
    v !== null &&
    "id" in v &&
    typeof (v as { id: unknown }).id === "string" &&
    (v as { id: string }).id.length > 0
  );
}
