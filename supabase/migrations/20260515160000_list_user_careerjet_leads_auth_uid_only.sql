-- A) Ensure next_steps exists (idempotent) for projects that still get REST 404 on /next_steps.
-- B) Replace list_user_careerjet_leads(uuid, text) with list_user_careerjet_leads(text):
--    scope strictly by auth.uid(); client no longer passes p_user_id (avoids 400 from forbidden / UUID coercion).

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
CREATE POLICY "next_steps_select_own"
  ON public.next_steps FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = next_steps.application_id AND a.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "next_steps_insert_own" ON public.next_steps;
CREATE POLICY "next_steps_insert_own"
  ON public.next_steps FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = next_steps.application_id AND a.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "next_steps_update_own" ON public.next_steps;
CREATE POLICY "next_steps_update_own"
  ON public.next_steps FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = next_steps.application_id AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = next_steps.application_id AND a.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "next_steps_delete_own" ON public.next_steps;
CREATE POLICY "next_steps_delete_own"
  ON public.next_steps FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = next_steps.application_id AND a.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.next_steps TO authenticated;

DROP FUNCTION IF EXISTS public.list_user_careerjet_leads(uuid, text);

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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  filter_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  filter_status := lower(btrim(coalesce(p_status, '')));
  IF filter_status NOT IN ('all', 'new', 'saved', 'applied') THEN
    filter_status := 'all';
  END IF;

  RETURN QUERY
  SELECT
    'canonical'::text AS row_kind,
    uo.id AS user_opportunity_id,
    uo.legacy_listing_status_id AS listing_status_id,
    uo.legacy_listing_id AS listing_id,
    uo.status,
    uo.relevance_score::numeric,
    uo.ai_score::numeric,
    uo.ai_scored_at,
    uo.ai_reasoning,
    uo.ai_match_highlights,
    uo.ai_concerns,
    uo.card_title AS title,
    uo.card_company AS employer,
    uo.card_location AS location,
    uo.card_salary AS salary,
    uo.card_salary_min AS salary_min,
    uo.card_salary_max AS salary_max,
    uo.card_salary_currency AS salary_currency,
    uo.card_published_at AS published_at,
    jl.source_url,
    uo.card_display_url AS display_url,
    uo.card_raw_url AS raw_url,
    uo.identity_fingerprint
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
    'legacy'::text,
    NULL::uuid,
    uj.id,
    jl.id,
    uj.status,
    uj.relevance_score::numeric,
    uj.ai_score::numeric,
    uj.ai_scored_at,
    uj.ai_reasoning,
    uj.ai_match_highlights,
    uj.ai_concerns,
    jl.title,
    jl.employer,
    jl.location,
    jl.salary,
    jl.salary_min,
    jl.salary_max,
    jl.salary_currency,
    jl.published_at,
    jl.source_url,
    jl.source_url AS display_url,
    jl.source_url AS raw_url,
    public.opportunity_fingerprint(jl.employer, jl.title, jl.location) AS identity_fingerprint
  FROM (
    SELECT DISTINCT ON (public.opportunity_fingerprint(jl2.employer, jl2.title, jl2.location))
      uj2.id,
      uj2.user_id,
      uj2.status,
      uj2.relevance_score,
      uj2.ai_score,
      uj2.ai_scored_at,
      uj2.ai_reasoning,
      uj2.ai_match_highlights,
      uj2.ai_concerns,
      uj2.listing_id,
      public.opportunity_fingerprint(jl2.employer, jl2.title, jl2.location) AS fp
    FROM public.user_job_listing_status uj2
    JOIN public.job_listings jl2 ON jl2.id = uj2.listing_id
    WHERE uj2.user_id = auth.uid()
      AND jl2.source = 'careerjet'
      AND NOT EXISTS (
        SELECT 1 FROM public.user_opportunities uo2
        WHERE uo2.user_id = auth.uid()
          AND uo2.identity_fingerprint = public.opportunity_fingerprint(
            jl2.employer, jl2.title, jl2.location
          )
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

COMMENT ON FUNCTION public.list_user_careerjet_leads(text) IS
  'Careerjet leads for auth.uid(): user_opportunities (canonical) plus legacy stragglers. p_status: all|new|saved|applied. Includes ai_scored_at. relevance_score/ai_score cast to numeric for RETURNS TABLE.';

NOTIFY pgrst, 'reload schema';
