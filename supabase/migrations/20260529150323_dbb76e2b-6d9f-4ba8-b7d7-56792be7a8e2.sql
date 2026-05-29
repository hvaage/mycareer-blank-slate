-- 20260514120000: documents FK + perf indexes
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_application_id_fkey') THEN
    UPDATE public.documents d SET application_id = NULL
    WHERE d.application_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.id = d.application_id);
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_application_id_fkey
      FOREIGN KEY (application_id) REFERENCES public.applications (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_documents_application_id
  ON public.documents (application_id) WHERE application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_user_updated_at
  ON public.documents (user_id, updated_at DESC NULLS LAST);

-- 20260515123000: next_steps table + policies
CREATE TABLE IF NOT EXISTS public.next_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  due_date date,
  priority public.priority_level DEFAULT 'middels'::public.priority_level,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_next_steps_application_id ON public.next_steps (application_id);
CREATE INDEX IF NOT EXISTS idx_next_steps_app_completed_due ON public.next_steps (application_id, completed, due_date);
ALTER TABLE public.next_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "next_steps_select_own" ON public.next_steps;
CREATE POLICY "next_steps_select_own" ON public.next_steps FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.applications a WHERE a.id = next_steps.application_id AND a.user_id = auth.uid()));
DROP POLICY IF EXISTS "next_steps_insert_own" ON public.next_steps;
CREATE POLICY "next_steps_insert_own" ON public.next_steps FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.applications a WHERE a.id = next_steps.application_id AND a.user_id = auth.uid()));
DROP POLICY IF EXISTS "next_steps_update_own" ON public.next_steps;
CREATE POLICY "next_steps_update_own" ON public.next_steps FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.applications a WHERE a.id = next_steps.application_id AND a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.applications a WHERE a.id = next_steps.application_id AND a.user_id = auth.uid()));
DROP POLICY IF EXISTS "next_steps_delete_own" ON public.next_steps;
CREATE POLICY "next_steps_delete_own" ON public.next_steps FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.applications a WHERE a.id = next_steps.application_id AND a.user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.next_steps TO authenticated;
GRANT ALL ON public.next_steps TO service_role;

-- 20260515160000 + 20260515190000: final list_user_careerjet_leads(text)
DROP FUNCTION IF EXISTS public.list_user_careerjet_leads(uuid, text);
DROP FUNCTION IF EXISTS public.list_user_careerjet_leads(text);

CREATE FUNCTION public.list_user_careerjet_leads(
  p_status text DEFAULT 'all'
)
RETURNS TABLE (
  row_kind text,
  user_opportunity_id uuid,
  listing_status_id uuid,
  listing_id uuid,
  status text,
  relevance_score numeric,
  ai_score numeric,
  ai_scored_at timestamptz,
  ai_reasoning text,
  ai_match_highlights text,
  ai_concerns text,
  title text,
  employer text,
  location text,
  salary text,
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  published_at timestamptz,
  source_url text,
  display_url text,
  raw_url text,
  identity_fingerprint text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE filter_status text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  filter_status := lower(btrim(coalesce(p_status, '')));
  IF filter_status NOT IN ('all','new','saved','applied') THEN filter_status := 'all'; END IF;

  RETURN QUERY
  SELECT
    'canonical'::text, uo.id, uo.legacy_listing_status_id, uo.legacy_listing_id,
    uo.status, uo.relevance_score::numeric, uo.ai_score::numeric, uo.ai_scored_at,
    uo.ai_reasoning, uo.ai_match_highlights, uo.ai_concerns,
    uo.card_title, uo.card_company, uo.card_location, uo.card_salary,
    uo.card_salary_min, uo.card_salary_max, uo.card_salary_currency,
    uo.card_published_at, jl.source_url, uo.card_display_url, uo.card_raw_url, uo.identity_fingerprint
  FROM public.user_opportunities uo
  LEFT JOIN public.user_job_listing_status ujs ON ujs.id = uo.legacy_listing_status_id
  LEFT JOIN public.job_listings jl ON jl.id = COALESCE(uo.legacy_listing_id, ujs.listing_id)
  WHERE uo.user_id = auth.uid()
    AND (
      filter_status = 'all' AND uo.status <> 'dismissed'
      OR filter_status = 'new' AND uo.status = 'new'
      OR filter_status = 'saved' AND uo.status = 'saved'
      OR filter_status = 'applied' AND uo.status = 'applied'
    );

  RETURN QUERY
  SELECT
    'legacy'::text, NULL::uuid, uj.id, jl.id,
    uj.status, uj.relevance_score::numeric, uj.ai_score::numeric, uj.ai_scored_at,
    uj.ai_reasoning, uj.ai_match_highlights, uj.ai_concerns,
    jl.title, jl.employer, jl.location, jl.salary,
    jl.salary_min, jl.salary_max, jl.salary_currency,
    jl.published_at, jl.source_url, jl.source_url, jl.source_url,
    public.opportunity_fingerprint(jl.employer, jl.title, jl.location)
  FROM (
    SELECT DISTINCT ON (public.opportunity_fingerprint(jl2.employer, jl2.title, jl2.location))
      uj2.id, uj2.user_id, uj2.status, uj2.relevance_score, uj2.ai_score, uj2.ai_scored_at,
      uj2.ai_reasoning, uj2.ai_match_highlights, uj2.ai_concerns, uj2.listing_id,
      public.opportunity_fingerprint(jl2.employer, jl2.title, jl2.location) AS fp
    FROM public.user_job_listing_status uj2
    JOIN public.job_listings jl2 ON jl2.id = uj2.listing_id
    WHERE uj2.user_id = auth.uid()
      AND jl2.source = 'careerjet'
      AND NOT EXISTS (
        SELECT 1 FROM public.user_opportunities uo2
        WHERE uo2.user_id = auth.uid()
          AND uo2.identity_fingerprint = public.opportunity_fingerprint(jl2.employer, jl2.title, jl2.location)
      )
      AND (
        filter_status = 'all' AND uj2.status <> 'dismissed'
        OR filter_status = 'new' AND uj2.status = 'new'
        OR filter_status = 'saved' AND uj2.status = 'saved'
        OR filter_status = 'applied' AND uj2.status = 'applied'
      )
    ORDER BY public.opportunity_fingerprint(jl2.employer, jl2.title, jl2.location), uj2.updated_at DESC NULLS LAST
  ) uj
  JOIN public.job_listings jl ON jl.id = uj.listing_id;
END;
$$;

REVOKE ALL ON FUNCTION public.list_user_careerjet_leads(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_user_careerjet_leads(text) TO authenticated;

-- 20260516100000: employer_analysis_jobs
CREATE TYPE public.employer_analysis_job_status AS ENUM ('queued','processing','completed','failed');

CREATE TABLE public.employer_analysis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  status public.employer_analysis_job_status NOT NULL DEFAULT 'queued',
  progress_percent smallint NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  current_step text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  artifact_document_id uuid REFERENCES public.documents (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_employer_analysis_jobs_user_created ON public.employer_analysis_jobs (user_id, created_at DESC);
CREATE INDEX idx_employer_analysis_jobs_company_created ON public.employer_analysis_jobs (company_id, created_at DESC);
CREATE UNIQUE INDEX employer_analysis_jobs_one_active_per_user_company
  ON public.employer_analysis_jobs (user_id, company_id) WHERE status IN ('queued','processing');

GRANT SELECT ON public.employer_analysis_jobs TO authenticated;
GRANT ALL ON public.employer_analysis_jobs TO service_role;

ALTER TABLE public.employer_analysis_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY employer_analysis_jobs_select_own ON public.employer_analysis_jobs
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER set_employer_analysis_jobs_updated_at
  BEFORE UPDATE ON public.employer_analysis_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260516120000: companies AI research columns
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS ai_culture_score numeric,
  ADD COLUMN IF NOT EXISTS ai_leadership_score numeric,
  ADD COLUMN IF NOT EXISTS ai_work_environment_score numeric,
  ADD COLUMN IF NOT EXISTS ai_career_development_score numeric,
  ADD COLUMN IF NOT EXISTS ai_financial_stability_score numeric,
  ADD COLUMN IF NOT EXISTS ai_mission_score numeric,
  ADD COLUMN IF NOT EXISTS ai_overall_score numeric,
  ADD COLUMN IF NOT EXISTS ai_rating_notes text,
  ADD COLUMN IF NOT EXISTS ai_dimension_notes jsonb,
  ADD COLUMN IF NOT EXISTS financials jsonb,
  ADD COLUMN IF NOT EXISTS ai_rated_at timestamptz,
  ADD COLUMN IF NOT EXISTS research_log jsonb;

-- 20260516130000: refresh_company_aggregate
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS agg_culture_score numeric,
  ADD COLUMN IF NOT EXISTS agg_leadership_score numeric,
  ADD COLUMN IF NOT EXISTS agg_work_environment_score numeric,
  ADD COLUMN IF NOT EXISTS agg_career_development_score numeric,
  ADD COLUMN IF NOT EXISTS agg_financial_stability_score numeric,
  ADD COLUMN IF NOT EXISTS agg_mission_score numeric,
  ADD COLUMN IF NOT EXISTS agg_overall_score numeric,
  ADD COLUMN IF NOT EXISTS agg_rating_count integer,
  ADD COLUMN IF NOT EXISTS agg_updated_at timestamptz;

CREATE OR REPLACE FUNCTION public.refresh_company_aggregate(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.companies SET
    agg_culture_score = (SELECT round(avg(culture_score)::numeric, 1) FROM public.user_company_ratings WHERE company_id = p_company_id),
    agg_leadership_score = (SELECT round(avg(leadership_score)::numeric, 1) FROM public.user_company_ratings WHERE company_id = p_company_id),
    agg_work_environment_score = (SELECT round(avg(work_environment_score)::numeric, 1) FROM public.user_company_ratings WHERE company_id = p_company_id),
    agg_career_development_score = (SELECT round(avg(career_development_score)::numeric, 1) FROM public.user_company_ratings WHERE company_id = p_company_id),
    agg_financial_stability_score = (SELECT round(avg(financial_stability_score)::numeric, 1) FROM public.user_company_ratings WHERE company_id = p_company_id),
    agg_mission_score = (SELECT round(avg(mission_score)::numeric, 1) FROM public.user_company_ratings WHERE company_id = p_company_id),
    agg_overall_score = (SELECT round(avg(overall_score)::numeric, 1) FROM public.user_company_ratings WHERE company_id = p_company_id),
    agg_rating_count = (SELECT count(*)::integer FROM public.user_company_ratings WHERE company_id = p_company_id),
    agg_updated_at = now(),
    updated_at = now()
  WHERE id = p_company_id;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_company_aggregate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_company_aggregate(uuid) TO authenticated;

-- 20260517120000: user_company_ratings.ai_candidate_fit_updated_at
ALTER TABLE public.user_company_ratings
  ADD COLUMN IF NOT EXISTS ai_candidate_fit_updated_at timestamptz;
