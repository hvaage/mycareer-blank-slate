import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/integrations/supabase/types";

export type CompanyRow = Tables<"companies">;
export type UserRatingRow = Tables<"user_company_ratings">;
export type EmployerAnalysisJobRow = Tables<"employer_analysis_jobs">;

export type EmployerListItem = CompanyRow & {
  myAvg: number | null;
  myFitScore: number | null;
  myRating: UserRatingRow | null;
};

export const CANDIDATE_FIT_UNAVAILABLE_PREFIX = "STATUS:KAN_IKKE_VURDERES";

export type CandidateFitUiState = "rated" | "unavailable" | "partial" | "none";

export function candidateFitUiState(
  r: Pick<UserRatingRow, "ai_candidate_fit_score" | "ai_candidate_fit_reasoning"> | null | undefined,
): CandidateFitUiState {
  if (!r) return "none";
  const reason = (r.ai_candidate_fit_reasoning ?? "").trimStart();
  if (reason.startsWith(CANDIDATE_FIT_UNAVAILABLE_PREFIX)) return "unavailable";
  if (typeof r.ai_candidate_fit_score === "number" && !Number.isNaN(r.ai_candidate_fit_score)) {
    return "rated";
  }
  if (reason.length > 0) return "partial";
  return "none";
}

export function displayCandidateFitReasoning(raw: string | null | undefined): string {
  if (!raw) return "";
  const t = raw.trimStart();
  if (t.startsWith(CANDIDATE_FIT_UNAVAILABLE_PREFIX)) {
    return t.slice(CANDIDATE_FIT_UNAVAILABLE_PREFIX.length).replace(/^\s*\n+/, "").trim();
  }
  return raw.trim();
}

export const EMPLOYER_ANALYSIS_STEP_LABELS: Record<string, string> = {
  queued: "I kø",
  starting: "Starter",
  claude_company_web_research: "AI — selskapsresearch på nett",
  parsing_and_validating: "Tolker AI-svar",
  writing_company_row: "Skriver AI-scorer til database",
  company_scores_saved: "Selskapsanalyse lagret",
  candidate_fit_preparing: "Forbereder kandidatmatch",
  claude_candidate_fit: "AI — kandidatmatch",
  candidate_fit_cached_company: "Kandidatmatch (eksisterende selskapsdata)",
  candidate_fit_saved: "Kandidatmatch lagret",
  candidate_fit_only: "Kun kandidatmatch",
  artifact_document: "Lagrer dokument (bibliotek)",
  done: "Ferdig",
  failed: "Feilet",
  rate_limited: "Midlertidig AI-begrensning — vent litt",
};

export type EmployersPageData = {
  employers: EmployerListItem[];
  jobsByCompanyId: Record<string, EmployerAnalysisJobRow>;
};

export type ActiveEmployerAnalysisJobRow = Pick<
  EmployerAnalysisJobRow,
  | "id"
  | "company_id"
  | "status"
  | "progress_percent"
  | "current_step"
  | "error_message"
  | "updated_at"
  | "retry_after_at"
> & {
  companies: { name: string | null } | null;
};

const RATING_FIELDS = [
  "culture_score",
  "leadership_score",
  "work_environment_score",
  "career_development_score",
  "financial_stability_score",
  "mission_score",
  "overall_score",
] as const;

function computeMyAvg(r: UserRatingRow | null): number | null {
  if (!r) return null;
  const vals = RATING_FIELDS.map((k) => (r as any)[k]).filter(
    (v): v is number => typeof v === "number" && !Number.isNaN(v),
  );
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

export const myEmployersQuery = () =>
  queryOptions({
    queryKey: ["employers"],
    staleTime: 30_000,
    queryFn: async (): Promise<EmployersPageData> => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return { employers: [], jobsByCompanyId: {} };

      const { data: rpcData, error: rpcErr } = await supabase.rpc("get_user_employers", {
        p_user_id: uid,
      });
      if (rpcErr) throw rpcErr;

      const ids = Array.from(new Set((rpcData ?? []).map((r: any) => r.company_id).filter(Boolean)));
      if (!ids.length) return { employers: [], jobsByCompanyId: {} };

      const [companiesRes, ratingsRes, jobsRes] = await Promise.all([
        supabase.from("companies").select("*").in("id", ids),
        supabase.from("user_company_ratings").select("*").eq("user_id", uid).in("company_id", ids),
        supabase
          .from("employer_analysis_jobs")
          .select("*")
          .eq("user_id", uid)
          .in("company_id", ids),
      ]);

      if (companiesRes.error) throw companiesRes.error;
      if (ratingsRes.error) throw ratingsRes.error;
      if (jobsRes.error) throw jobsRes.error;

      const ratingsByCompany = new Map<string, UserRatingRow>();
      for (const r of ratingsRes.data ?? []) {
        if (r.company_id) ratingsByCompany.set(r.company_id, r);
      }

      const jobsByCompanyId: Record<string, EmployerAnalysisJobRow> = {};
      for (const j of jobsRes.data ?? []) {
        const row = j as EmployerAnalysisJobRow;
        const cur = jobsByCompanyId[row.company_id];
        if (!cur || new Date(row.created_at) > new Date(cur.created_at)) {
          jobsByCompanyId[row.company_id] = row;
        }
      }

      const employers: EmployerListItem[] = (companiesRes.data ?? []).map((c) => {
        const myRating = ratingsByCompany.get(c.id) ?? null;
        return {
          ...c,
          myRating,
          myAvg: computeMyAvg(myRating),
          myFitScore: myRating?.ai_candidate_fit_score ?? null,
        };
      });

      return { employers, jobsByCompanyId };
    },
  });

export const activeEmployerAnalysisJobsQuery = () =>
  queryOptions({
    queryKey: ["employer-analysis-jobs", "active"],
    staleTime: 0,
    queryFn: async (): Promise<ActiveEmployerAnalysisJobRow[]> => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return [];

      const { data, error } = await supabase
        .from("employer_analysis_jobs")
        .select(
          "id, company_id, status, progress_percent, current_step, error_message, updated_at, retry_after_at, companies(name)",
        )
        .eq("user_id", uid)
        .in("status", ["queued", "processing", "rate_limited"])
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as ActiveEmployerAnalysisJobRow[];
    },
    refetchInterval: (q) => {
      const rows = q.state.data ?? [];
      if (!rows.length) return false;
      const busy = rows.some((r) => r.status === "queued" || r.status === "processing");
      if (busy) return 2500;
      const rateWait = rows.some((r) => {
        if (r.status !== "rate_limited") return false;
        const ra = r.retry_after_at;
        return !!ra && new Date(ra) > new Date();
      });
      return rateWait ? 8000 : false;
    },
  });

export const latestEmployerAnalysisJobQuery = (companyId: string) =>
  queryOptions({
    queryKey: ["employer-analysis-job", companyId],
    staleTime: 10_000,
    queryFn: async (): Promise<EmployerAnalysisJobRow | null> => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return null;

      const { data, error } = await supabase
        .from("employer_analysis_jobs")
        .select("*")
        .eq("company_id", companyId)
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as EmployerAnalysisJobRow | null;
    },
    refetchInterval: (q) => {
      const row = q.state.data;
      const s = row?.status;
      if (s === "queued" || s === "processing") return 2500;
      if (s === "rate_limited" && row?.retry_after_at && new Date(row.retry_after_at) > new Date()) {
        return 8000;
      }
      return false;
    },
  });

export const companyDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ["company", id],
    staleTime: 30_000,
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;

      const [companyRes, ratingRes] = await Promise.all([
        supabase.from("companies").select("*").eq("id", id).maybeSingle(),
        uid
          ? supabase
              .from("user_company_ratings")
              .select("*")
              .eq("user_id", uid)
              .eq("company_id", id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null } as any),
      ]);

      if (companyRes.error) throw companyRes.error;
      if (ratingRes.error) throw ratingRes.error;

      return {
        company: companyRes.data,
        myRating: ratingRes.data as UserRatingRow | null,
      };
    },
  });
