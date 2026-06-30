-- Admin ingestion planner stats canary.
-- Run after 20260630154500_admin_ingestion_analyze_stats.sql.
-- Read-only: verifies the optimized RPC path executes inside the Admin UI
-- timeout budget after planner statistics refresh.

BEGIN;

SET LOCAL statement_timeout = '3000ms';
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

CREATE OR REPLACE FUNCTION pg_temp.must(p_label text, p_condition boolean)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, false) THEN
    RAISE EXCEPTION 'FAIL: %', p_label;
  END IF;
END;
$$;

DO $tests$
DECLARE
  v_payload jsonb;
  v_daily jsonb;
  v_def text := pg_get_functiondef('public.get_admin_ingestion_status(integer,text)'::regprocedure);
BEGIN
  PERFORM pg_temp.must(
    'enheter updated index exists',
    to_regclass('reg.idx_admin_enheter_oppdatert_tidspunkt_desc_nulls_last') IS NOT NULL
  );
  PERFORM pg_temp.must(
    'enheter fetched index exists',
    to_regclass('reg.idx_admin_enheter_hentet_tidspunkt_desc_nulls_last') IS NOT NULL
  );
  PERFORM pg_temp.must(
    'function uses NULLS LAST for latest enheter updated',
    v_def LIKE '%ORDER BY e.oppdatert_tidspunkt DESC NULLS LAST%'
  );
  PERFORM pg_temp.must(
    'function uses NULLS LAST for latest enheter fetched',
    v_def LIKE '%ORDER BY e.hentet_tidspunkt DESC NULLS LAST%'
  );

  v_payload := public.get_admin_ingestion_status(14, 'Europe/Oslo');
  v_daily := v_payload #> '{nav,daily_new_unique_postings}';

  PERFORM pg_temp.must('payload is object', jsonb_typeof(v_payload) = 'object');
  PERFORM pg_temp.must('has brreg', v_payload ? 'brreg');
  PERFORM pg_temp.must('has nav', v_payload ? 'nav');
  PERFORM pg_temp.must('window days preserved', (v_payload #>> '{window,days}')::integer = 14);
  PERFORM pg_temp.must('daily NAV array exists', jsonb_typeof(v_daily) = 'array');
  PERFORM pg_temp.must('daily NAV array has requested days', jsonb_array_length(v_daily) = 14);
  PERFORM pg_temp.must(
    'regnskap sync status counts remain estimates',
    v_payload #>> '{count_strategy,regnskap_sync_status_counts}' = 'partial_index_estimate'
  );

  RAISE NOTICE 'Admin ingestion planner stats tests PASS';
END
$tests$;

ROLLBACK;
