
-- M5.6: NAV canonical feed schema + RPC

-- 1) source_postings: posting_status / expired_at / last_seen_at
ALTER TABLE public.source_postings
  ADD COLUMN IF NOT EXISTS posting_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS expired_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='source_postings_posting_status_chk'
      AND conrelid='public.source_postings'::regclass
  ) THEN
    ALTER TABLE public.source_postings
      ADD CONSTRAINT source_postings_posting_status_chk
      CHECK (posting_status IN ('active','expired','removed')) NOT VALID;
    ALTER TABLE public.source_postings VALIDATE CONSTRAINT source_postings_posting_status_chk;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_source_postings_source_status
  ON public.source_postings (source, posting_status);

-- 2) canonical_opportunities: live_until
ALTER TABLE public.canonical_opportunities
  ADD COLUMN IF NOT EXISTS live_until timestamptz;

-- 3) user_opportunities: card_source
ALTER TABLE public.user_opportunities
  ADD COLUMN IF NOT EXISTS card_source text;

-- 4) nav_sync_runs
CREATE TABLE IF NOT EXISTS public.nav_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  fetched int NOT NULL DEFAULT 0,
  upserted int NOT NULL DEFAULT 0,
  expired int NOT NULL DEFAULT 0,
  reactivated int NOT NULL DEFAULT 0,
  matched_user_opps int NOT NULL DEFAULT 0,
  scored int NOT NULL DEFAULT 0,
  error_summary text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS nav_sync_runs_finished_idx
  ON public.nav_sync_runs (finished_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS nav_sync_runs_unfinished_idx
  ON public.nav_sync_runs (started_at DESC) WHERE finished_at IS NULL;

GRANT SELECT ON public.nav_sync_runs TO authenticated;
GRANT ALL ON public.nav_sync_runs TO service_role;
ALTER TABLE public.nav_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nav_sync_runs_admin_read ON public.nav_sync_runs;
DO $pol$
DECLARE has_role_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='has_role'
  ) AND EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname='public' AND t.typname='app_role'
  ) INTO has_role_ok;
  IF has_role_ok THEN
    EXECUTE 'CREATE POLICY nav_sync_runs_admin_read ON public.nav_sync_runs
             FOR SELECT TO authenticated
             USING (public.has_role(auth.uid(), ''admin''::public.app_role))';
  ELSE
    RAISE NOTICE 'has_role/app_role missing; nav_sync_runs has no authenticated SELECT policy';
  END IF;
END $pol$;

-- 5) list_user_job_opportunities — unified read across canonical (NAV+Careerjet), legacy Careerjet, LinkedIn
CREATE OR REPLACE FUNCTION public.list_user_job_opportunities(
  p_status text DEFAULT 'all',
  p_source text DEFAULT 'all'
)
RETURNS TABLE(
  row_kind text,
  source text,
  sources text[],
  user_opportunity_id uuid,
  listing_status_id uuid,
  listing_id uuid,
  canonical_opportunity_id uuid,
  linkedin_lead_id uuid,
  status text,
  is_expired boolean,
  live_until timestamptz,
  relevance_score numeric,
  ai_score numeric,
  ai_scored_at timestamptz,
  ai_reasoning text,
  ai_match_highlights text,
  ai_concerns text,
  title text,
  employer text,
  location text,
  work_type text,
  salary text,
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  published_at timestamptz,
  source_url text,
  display_url text,
  raw_url text,
  identity_fingerprint text,
  -- LinkedIn extras
  posted_text text,
  raw_snippet text,
  source_subject text,
  source_email_from text,
  received_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  filter_status text;
  filter_source text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  filter_status := lower(btrim(coalesce(p_status, 'all')));
  IF filter_status NOT IN ('all','new','saved','applied','all-history') THEN
    filter_status := 'all';
  END IF;
  filter_source := lower(btrim(coalesce(p_source, 'all')));
  IF filter_source NOT IN ('all','nav','careerjet','linkedin') THEN
    filter_source := 'all';
  END IF;

  -- Canonical branch (NAV + Careerjet via user_opportunities + canonical_opportunities)
  IF filter_source IN ('all','nav','careerjet') THEN
    RETURN QUERY
    WITH co_src AS (
      SELECT
        osl.canonical_opportunity_id,
        array_agg(DISTINCT sp.source) AS sources,
        bool_and(coalesce(sp.posting_status IN ('expired','removed'), false)) AS all_expired
      FROM public.opportunity_source_links osl
      JOIN public.source_postings sp ON sp.id = osl.source_posting_id
      GROUP BY osl.canonical_opportunity_id
    )
    SELECT
      'canonical'::text,
      coalesce(co.primary_source, 'careerjet')::text,
      coalesce(cs.sources, ARRAY[]::text[]),
      uo.id, uo.legacy_listing_status_id, uo.legacy_listing_id, uo.canonical_opportunity_id,
      NULL::uuid,
      uo.status,
      (co.live_until IS NOT NULL AND co.live_until > now())::boolean,
      co.live_until,
      uo.relevance_score::numeric, uo.ai_score::numeric, uo.ai_scored_at,
      uo.ai_reasoning, uo.ai_match_highlights, uo.ai_concerns,
      uo.card_title, uo.card_company, uo.card_location, NULL::text,
      uo.card_salary, uo.card_salary_min, uo.card_salary_max, uo.card_salary_currency,
      uo.card_published_at,
      uo.card_display_url, uo.card_display_url, uo.card_raw_url,
      uo.identity_fingerprint,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz
    FROM public.user_opportunities uo
    JOIN public.canonical_opportunities co ON co.id = uo.canonical_opportunity_id
    LEFT JOIN co_src cs ON cs.canonical_opportunity_id = co.id
    WHERE uo.user_id = auth.uid()
      AND (
        filter_status = 'all'         AND uo.status <> 'dismissed'
        OR filter_status = 'all-history'
        OR filter_status = 'new'      AND uo.status = 'new'
        OR filter_status = 'saved'    AND uo.status = 'saved'
        OR filter_status = 'applied'  AND uo.status = 'applied'
      )
      AND (
        filter_source = 'all'
        OR (filter_source = 'nav' AND EXISTS (
              SELECT 1 FROM public.opportunity_source_links osl2
              JOIN public.source_postings sp2 ON sp2.id = osl2.source_posting_id
              WHERE osl2.canonical_opportunity_id = co.id AND sp2.source = 'nav'))
        OR (filter_source = 'careerjet' AND EXISTS (
              SELECT 1 FROM public.opportunity_source_links osl2
              JOIN public.source_postings sp2 ON sp2.id = osl2.source_posting_id
              WHERE osl2.canonical_opportunity_id = co.id AND sp2.source = 'careerjet'))
      )
      AND (
        filter_status = 'all-history'
        OR co.live_until IS NULL
        OR co.live_until > now()
      );
  END IF;

  -- Legacy Careerjet (rows without canonical)
  IF filter_source IN ('all','careerjet') THEN
    RETURN QUERY
    SELECT
      'legacy'::text,
      'careerjet'::text,
      ARRAY['careerjet']::text[],
      NULL::uuid, uj.id, jl.id, NULL::uuid, NULL::uuid,
      uj.status,
      false::boolean, NULL::timestamptz,
      uj.relevance_score::numeric, uj.ai_score::numeric, uj.ai_scored_at,
      uj.ai_reasoning, uj.ai_match_highlights, uj.ai_concerns,
      jl.title, jl.employer, jl.location, NULL::text,
      jl.salary, jl.salary_min, jl.salary_max, jl.salary_currency,
      jl.published_at, jl.source_url, jl.source_url, jl.source_url,
      public.opportunity_fingerprint(jl.employer, jl.title, jl.location),
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz
    FROM (
      SELECT DISTINCT ON (public.opportunity_fingerprint(jl2.employer, jl2.title, jl2.location))
        uj2.id, uj2.user_id, uj2.status, uj2.relevance_score, uj2.ai_score, uj2.ai_scored_at,
        uj2.ai_reasoning, uj2.ai_match_highlights, uj2.ai_concerns, uj2.listing_id, uj2.updated_at
      FROM public.user_job_listing_status uj2
      JOIN public.job_listings jl2 ON jl2.id = uj2.listing_id
      WHERE uj2.user_id = auth.uid() AND jl2.source = 'careerjet'
        AND NOT EXISTS (
          SELECT 1 FROM public.user_opportunities uo2
          WHERE uo2.user_id = auth.uid()
            AND uo2.identity_fingerprint =
              public.opportunity_fingerprint(jl2.employer, jl2.title, jl2.location)
        )
        AND (
          filter_status = 'all'         AND uj2.status <> 'dismissed'
          OR filter_status = 'all-history'
          OR filter_status = 'new'      AND uj2.status = 'new'
          OR filter_status = 'saved'    AND uj2.status = 'saved'
          OR filter_status = 'applied'  AND uj2.status = 'applied'
        )
      ORDER BY public.opportunity_fingerprint(jl2.employer, jl2.title, jl2.location),
               uj2.updated_at DESC NULLS LAST
    ) uj
    JOIN public.job_listings jl ON jl.id = uj.listing_id;
  END IF;

  -- LinkedIn (job_leads)
  IF filter_source IN ('all','linkedin') THEN
    RETURN QUERY
    SELECT
      'linkedin'::text,
      'linkedin'::text,
      ARRAY['linkedin']::text[],
      NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, jl.id,
      jl.status,
      false::boolean, NULL::timestamptz,
      NULL::numeric, jl.ai_score::numeric, NULL::timestamptz,
      jl.ai_reasoning, jl.ai_match_highlights, jl.ai_concerns,
      jl.title, jl.company, jl.location, jl.work_type,
      jl.salary_text, NULL::numeric, NULL::numeric, NULL::text,
      jl.received_at, jl.job_url, jl.job_url, jl.job_url,
      NULL::text,
      jl.posted_text, jl.raw_snippet, jl.source_subject, jl.source_email_from, jl.received_at
    FROM public.job_leads jl
    WHERE jl.user_id = auth.uid()
      AND (
        filter_status = 'all'         AND jl.status <> 'avvist'
        OR filter_status = 'all-history'
        OR filter_status = 'new'      AND jl.status = 'ny'
        OR filter_status = 'applied'  AND jl.status = 'promotert'
        OR filter_status = 'saved'    AND FALSE
      );
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_user_job_opportunities(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_user_job_opportunities(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
