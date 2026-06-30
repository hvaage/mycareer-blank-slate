-- Fix remaining Admin ingestion timeout on latest timestamp lookups.
--
-- 20260630143000 made broad status counters estimate-based, but production
-- still timed out on reg.enheter ORDER BY oppdatert_tidspunkt DESC LIMIT 1.
-- These dashboard "latest" values must be cheap index reads, never table
-- sorts. No sync/data/cron/secret changes.

CREATE INDEX IF NOT EXISTS idx_admin_enheter_hentet_tidspunkt_desc_nulls_last
  ON reg.enheter (hentet_tidspunkt DESC NULLS LAST)
  WHERE hentet_tidspunkt IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_enheter_oppdatert_tidspunkt_desc_nulls_last
  ON reg.enheter (oppdatert_tidspunkt DESC NULLS LAST)
  WHERE oppdatert_tidspunkt IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_regnskap_hentet_tidspunkt_desc_nulls_last
  ON reg.regnskap (hentet_tidspunkt DESC NULLS LAST)
  WHERE hentet_tidspunkt IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_regnskap_regnskapsaar_desc_nulls_last
  ON reg.regnskap (regnskapsaar DESC NULLS LAST)
  WHERE regnskapsaar IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_regnskap_sync_latest_regnskapsaar_desc_nulls_last
  ON reg.regnskap_sync_status (latest_regnskapsaar DESC NULLS LAST)
  WHERE latest_regnskapsaar IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_regnskap_sync_last_success_at_desc_nulls_last
  ON reg.regnskap_sync_status (last_success_at DESC NULLS LAST)
  WHERE last_success_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_regnskap_sync_last_checked_at_desc_nulls_last
  ON reg.regnskap_sync_status (last_checked_at DESC NULLS LAST)
  WHERE last_checked_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_source_postings_nav_created_desc_nulls_last
  ON public.source_postings (created_at DESC NULLS LAST)
  WHERE source = 'nav';

CREATE INDEX IF NOT EXISTS idx_admin_source_postings_nav_last_seen_desc_nulls_last
  ON public.source_postings (last_seen_at DESC NULLS LAST)
  WHERE source = 'nav' AND last_seen_at IS NOT NULL;

DO $$
DECLARE
  v_sql text;
BEGIN
  SELECT pg_get_functiondef('public.get_admin_ingestion_status(integer,text)'::regprocedure)
  INTO v_sql;

  IF v_sql IS NULL THEN
    RAISE EXCEPTION 'public.get_admin_ingestion_status(integer,text) not found';
  END IF;

  IF v_sql NOT LIKE '%ORDER BY e.hentet_tidspunkt DESC NULLS LAST%' THEN
    v_sql := replace(
      v_sql,
      'ORDER BY e.hentet_tidspunkt DESC',
      'ORDER BY e.hentet_tidspunkt DESC NULLS LAST'
    );
  END IF;

  IF v_sql NOT LIKE '%ORDER BY e.oppdatert_tidspunkt DESC NULLS LAST%' THEN
    v_sql := replace(
      v_sql,
      'ORDER BY e.oppdatert_tidspunkt DESC',
      'ORDER BY e.oppdatert_tidspunkt DESC NULLS LAST'
    );
  END IF;

  IF v_sql NOT LIKE '%ORDER BY r.regnskapsaar DESC NULLS LAST%' THEN
    v_sql := replace(
      v_sql,
      'ORDER BY r.regnskapsaar DESC',
      'ORDER BY r.regnskapsaar DESC NULLS LAST'
    );
  END IF;

  IF v_sql NOT LIKE '%ORDER BY r.hentet_tidspunkt DESC NULLS LAST%' THEN
    v_sql := replace(
      v_sql,
      'ORDER BY r.hentet_tidspunkt DESC',
      'ORDER BY r.hentet_tidspunkt DESC NULLS LAST'
    );
  END IF;

  IF v_sql NOT LIKE '%ORDER BY s.latest_regnskapsaar DESC NULLS LAST%' THEN
    v_sql := replace(
      v_sql,
      'ORDER BY s.latest_regnskapsaar DESC',
      'ORDER BY s.latest_regnskapsaar DESC NULLS LAST'
    );
  END IF;

  IF v_sql NOT LIKE '%ORDER BY s.last_success_at DESC NULLS LAST%' THEN
    v_sql := replace(
      v_sql,
      'ORDER BY s.last_success_at DESC',
      'ORDER BY s.last_success_at DESC NULLS LAST'
    );
  END IF;

  IF v_sql NOT LIKE '%ORDER BY s.last_checked_at DESC NULLS LAST%' THEN
    v_sql := replace(
      v_sql,
      'ORDER BY s.last_checked_at DESC',
      'ORDER BY s.last_checked_at DESC NULLS LAST'
    );
  END IF;

  IF v_sql NOT LIKE '%ORDER BY sp.created_at DESC NULLS LAST%' THEN
    v_sql := replace(
      v_sql,
      'ORDER BY sp.created_at DESC',
      'ORDER BY sp.created_at DESC NULLS LAST'
    );
  END IF;

  IF v_sql NOT LIKE '%ORDER BY sp.last_seen_at DESC NULLS LAST%' THEN
    v_sql := replace(
      v_sql,
      'ORDER BY sp.last_seen_at DESC',
      'ORDER BY sp.last_seen_at DESC NULLS LAST'
    );
  END IF;

  EXECUTE v_sql;
END $$;

COMMENT ON FUNCTION public.get_admin_ingestion_status(integer, text) IS
  'Admin-only read model for Brreg/Regnskap/NAV ingestion counts. Ultrafast dashboard path; latest timestamp lookups use DESC NULLS LAST indexes; no mutations.';
