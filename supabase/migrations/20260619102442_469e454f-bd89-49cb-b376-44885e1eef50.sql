
-- M5.7: Careerjet inn i felles jobbtrakt

-- 1) source_postings: legg til reactivated_at (idempotent)
ALTER TABLE public.source_postings
  ADD COLUMN IF NOT EXISTS reactivated_at timestamptz;

-- 2) careerjet_sync_runs (mirror nav_sync_runs)
CREATE TABLE IF NOT EXISTS public.careerjet_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  cursor_term text,
  cursor_page int,
  rows_fetched int NOT NULL DEFAULT 0,
  rows_upserted int NOT NULL DEFAULT 0,
  rows_expired int NOT NULL DEFAULT 0,
  rows_reactivated int NOT NULL DEFAULT 0,
  rows_failed int NOT NULL DEFAULT 0,
  terms_covered int NOT NULL DEFAULT 0,
  api_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_summary text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='careerjet_sync_runs_status_chk'
      AND conrelid='public.careerjet_sync_runs'::regclass
  ) THEN
    ALTER TABLE public.careerjet_sync_runs
      ADD CONSTRAINT careerjet_sync_runs_status_chk
      CHECK (status IN ('running','success','partial','failed','already_running'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS careerjet_sync_runs_finished_idx
  ON public.careerjet_sync_runs (finished_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS careerjet_sync_runs_unfinished_idx
  ON public.careerjet_sync_runs (started_at DESC) WHERE finished_at IS NULL;

GRANT SELECT ON public.careerjet_sync_runs TO authenticated;
GRANT ALL ON public.careerjet_sync_runs TO service_role;
ALTER TABLE public.careerjet_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS careerjet_sync_runs_admin_read ON public.careerjet_sync_runs;
CREATE POLICY careerjet_sync_runs_admin_read ON public.careerjet_sync_runs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role));

-- 3) careerjet_search_terms
CREATE TABLE IF NOT EXISTS public.careerjet_search_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term text NOT NULL,
  locale text NOT NULL DEFAULT 'no_NO',
  location text,
  active boolean NOT NULL DEFAULT true,
  priority int NOT NULL DEFAULT 50,
  last_run_at timestamptz,
  source text NOT NULL DEFAULT 'curated',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='careerjet_search_terms_source_chk'
  ) THEN
    ALTER TABLE public.careerjet_search_terms
      ADD CONSTRAINT careerjet_search_terms_source_chk
      CHECK (source IN ('user_keyword','user_location','curated'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS careerjet_search_terms_unique
  ON public.careerjet_search_terms (lower(term), lower(coalesce(location,'')));
CREATE INDEX IF NOT EXISTS careerjet_search_terms_active_last_run_idx
  ON public.careerjet_search_terms (active, last_run_at NULLS FIRST);

GRANT SELECT ON public.careerjet_search_terms TO authenticated;
GRANT ALL ON public.careerjet_search_terms TO service_role;
ALTER TABLE public.careerjet_search_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS careerjet_search_terms_admin_read ON public.careerjet_search_terms;
CREATE POLICY careerjet_search_terms_admin_read ON public.careerjet_search_terms
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role));

-- Seed curated fallback terms (idempotent via unique index)
INSERT INTO public.careerjet_search_terms (term, locale, location, source, priority)
VALUES
  ('utvikler','no_NO',NULL,'curated',80),
  ('developer','no_NO',NULL,'curated',80),
  ('ingeniør','no_NO',NULL,'curated',70),
  ('sykepleier','no_NO',NULL,'curated',70),
  ('lærer','no_NO',NULL,'curated',60),
  ('konsulent','no_NO',NULL,'curated',60),
  ('prosjektleder','no_NO',NULL,'curated',60),
  ('regnskap','no_NO',NULL,'curated',55),
  ('controller','no_NO',NULL,'curated',55),
  ('selger','no_NO',NULL,'curated',55),
  ('markedsfører','no_NO',NULL,'curated',50),
  ('designer','no_NO',NULL,'curated',50),
  ('data engineer','no_NO',NULL,'curated',50),
  ('product manager','no_NO',NULL,'curated',50),
  ('elektriker','no_NO',NULL,'curated',50)
ON CONFLICT DO NOTHING;

-- 4) RPC link_canonical_to_source
CREATE OR REPLACE FUNCTION public.link_canonical_to_source(
  p_canonical uuid,
  p_posting uuid,
  p_merge_reason text DEFAULT 'import'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
  v_role text;
  v_id uuid;
BEGIN
  SELECT id INTO v_existing FROM public.opportunity_source_links
    WHERE canonical_opportunity_id = p_canonical AND source_posting_id = p_posting
    LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.opportunity_source_links
    WHERE canonical_opportunity_id = p_canonical AND link_role = 'primary'
  ) THEN
    v_role := 'primary';
  ELSE
    v_role := 'variant';
  END IF;

  INSERT INTO public.opportunity_source_links
    (canonical_opportunity_id, source_posting_id, link_role, merge_reason)
  VALUES (p_canonical, p_posting, v_role, COALESCE(p_merge_reason,'import'))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_canonical_to_source(uuid,uuid,text) FROM public;
GRANT EXECUTE ON FUNCTION public.link_canonical_to_source(uuid,uuid,text) TO service_role;

-- 5) RPC mark_stale_careerjet_postings
CREATE OR REPLACE FUNCTION public.mark_stale_careerjet_postings(p_days int DEFAULT 7)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  WITH expired AS (
    UPDATE public.source_postings sp
    SET posting_status = 'expired',
        expired_at = COALESCE(sp.expired_at, now()),
        raw_payload = COALESCE(sp.raw_payload, '{}'::jsonb)
          || jsonb_build_object(
            'careerjet_lifecycle_events',
            COALESCE(sp.raw_payload->'careerjet_lifecycle_events','[]'::jsonb)
              || jsonb_build_array(jsonb_build_object(
                'event','expired_by_stale',
                'at', now(),
                'days', p_days
              ))
          ),
        updated_at = now()
    WHERE sp.source = 'careerjet'
      AND sp.posting_status = 'active'
      AND sp.last_seen_at IS NOT NULL
      AND sp.last_seen_at < now() - (p_days || ' days')::interval
    RETURNING sp.id
  )
  SELECT count(*) INTO v_count FROM expired;
  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_stale_careerjet_postings(int) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_stale_careerjet_postings(int) TO service_role;

-- 6) Admin RPCs for careerjet sync
CREATE OR REPLACE FUNCTION public.get_careerjet_sync_cron_info()
RETURNS TABLE(jobname text, schedule text, active boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, cron, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT j.jobname::text, j.schedule::text, j.active
    FROM cron.job j WHERE j.jobname='careerjet-sync-60min' LIMIT 1;
END; $$;

CREATE OR REPLACE FUNCTION public.careerjet_sync_vault_has_secret()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE found boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE='42501';
  END IF;
  SELECT EXISTS(SELECT 1 FROM vault.secrets WHERE name='sync_careerjet_secret') INTO found;
  RETURN COALESCE(found,false);
END; $$;

CREATE OR REPLACE FUNCTION public.careerjet_sync_duplicate_external_ids()
RETURNS TABLE(external_id text, count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
    SELECT sp.source_external_id::text, count(*)::bigint
    FROM public.source_postings sp
    WHERE sp.source='careerjet' AND sp.source_external_id IS NOT NULL
    GROUP BY sp.source_external_id HAVING count(*) > 1
    ORDER BY count(*) DESC LIMIT 100;
END; $$;

CREATE OR REPLACE FUNCTION public.careerjet_sync_distinct_external_count()
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE n bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE='42501';
  END IF;
  SELECT count(DISTINCT sp.source_external_id) INTO n
  FROM public.source_postings sp
  WHERE sp.source='careerjet' AND sp.source_external_id IS NOT NULL;
  RETURN COALESCE(n,0);
END; $$;

CREATE OR REPLACE FUNCTION public.careerjet_sync_count_missing_raw_payload()
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE n bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE='42501';
  END IF;
  SELECT count(*) INTO n FROM public.source_postings sp
  WHERE sp.source='careerjet' AND sp.posting_status='active' AND sp.raw_payload IS NULL;
  RETURN COALESCE(n,0);
END; $$;

CREATE OR REPLACE FUNCTION public.careerjet_sync_last_seen_stats()
RETURNS TABLE(min_last_seen timestamptz, max_last_seen timestamptz, median_last_seen timestamptz, active_count bigint, expired_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
    SELECT
      min(sp.last_seen_at),
      max(sp.last_seen_at),
      (percentile_cont(0.5) WITHIN GROUP (ORDER BY sp.last_seen_at))::timestamptz,
      count(*) FILTER (WHERE sp.posting_status='active')::bigint,
      count(*) FILTER (WHERE sp.posting_status IN ('expired','removed'))::bigint
    FROM public.source_postings sp WHERE sp.source='careerjet';
END; $$;

CREATE OR REPLACE FUNCTION public.careerjet_sync_term_coverage()
RETURNS TABLE(total_active bigint, run_last_24h bigint, run_last_7d bigint, oldest_last_run_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
    SELECT
      count(*) FILTER (WHERE active)::bigint,
      count(*) FILTER (WHERE active AND last_run_at >= now() - interval '24 hours')::bigint,
      count(*) FILTER (WHERE active AND last_run_at >= now() - interval '7 days')::bigint,
      min(last_run_at) FILTER (WHERE active)
    FROM public.careerjet_search_terms;
END; $$;

CREATE OR REPLACE FUNCTION public.careerjet_sync_external_id_prefix_counts()
RETURNS TABLE(prefix text, count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
    SELECT
      CASE
        WHEN sp.source_external_id LIKE 'cj_id_%' THEN 'cj_id_'
        WHEN sp.source_external_id LIKE 'cj_url_%' THEN 'cj_url_'
        WHEN sp.source_external_id LIKE 'cj_fp_%' THEN 'cj_fp_'
        ELSE 'other'
      END AS prefix,
      count(*)::bigint
    FROM public.source_postings sp
    WHERE sp.source='careerjet'
    GROUP BY 1 ORDER BY 2 DESC;
END; $$;

REVOKE ALL ON FUNCTION public.get_careerjet_sync_cron_info() FROM public;
REVOKE ALL ON FUNCTION public.careerjet_sync_vault_has_secret() FROM public;
REVOKE ALL ON FUNCTION public.careerjet_sync_duplicate_external_ids() FROM public;
REVOKE ALL ON FUNCTION public.careerjet_sync_distinct_external_count() FROM public;
REVOKE ALL ON FUNCTION public.careerjet_sync_count_missing_raw_payload() FROM public;
REVOKE ALL ON FUNCTION public.careerjet_sync_last_seen_stats() FROM public;
REVOKE ALL ON FUNCTION public.careerjet_sync_term_coverage() FROM public;
REVOKE ALL ON FUNCTION public.careerjet_sync_external_id_prefix_counts() FROM public;

GRANT EXECUTE ON FUNCTION public.get_careerjet_sync_cron_info() TO authenticated;
GRANT EXECUTE ON FUNCTION public.careerjet_sync_vault_has_secret() TO authenticated;
GRANT EXECUTE ON FUNCTION public.careerjet_sync_duplicate_external_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.careerjet_sync_distinct_external_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.careerjet_sync_count_missing_raw_payload() TO authenticated;
GRANT EXECUTE ON FUNCTION public.careerjet_sync_last_seen_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.careerjet_sync_term_coverage() TO authenticated;
GRANT EXECUTE ON FUNCTION public.careerjet_sync_external_id_prefix_counts() TO authenticated;

NOTIFY pgrst, 'reload schema';
