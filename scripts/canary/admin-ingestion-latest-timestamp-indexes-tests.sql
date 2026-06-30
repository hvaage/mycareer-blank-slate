-- Admin ingestion latest timestamp index canary.
-- Run after 20260630152000_admin_ingestion_latest_timestamp_indexes.sql.
-- Read-only: verifies indexes/function patch and executes the RPC under a
-- short timeout matching the Admin UI failure mode.

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
    'enheter hentet timestamp index exists',
    to_regclass('reg.idx_admin_enheter_hentet_tidspunkt_desc_nulls_last') IS NOT NULL
  );
  PERFORM pg_temp.must(
    'enheter oppdatert timestamp index exists',
    to_regclass('reg.idx_admin_enheter_oppdatert_tidspunkt_desc_nulls_last') IS NOT NULL
  );
  PERFORM pg_temp.must(
    'function orders latest enheter updated with NULLS LAST',
    v_def LIKE '%ORDER BY e.oppdatert_tidspunkt DESC NULLS LAST%'
  );
  PERFORM pg_temp.must(
    'function orders latest enheter fetched with NULLS LAST',
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

  RAISE NOTICE 'Admin ingestion latest timestamp index tests PASS';
END
$tests$;

ROLLBACK;
