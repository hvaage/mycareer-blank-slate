-- Admin ingestion pg_stats timestamp canary.
-- Run after 20260630161000_admin_ingestion_stats_timestamps.sql.
-- Read-only: verifies large-table latest timestamp scans were removed from
-- get_admin_ingestion_status and the RPC executes inside the UI timeout.

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
    'stats timestamp helper exists',
    to_regprocedure('public._admin_pg_stats_upper_timestamptz(text,text,text)') IS NOT NULL
  );
  PERFORM pg_temp.must(
    'removed enheter updated latest scan',
    v_def !~ 'FROM reg\.enheter e[[:space:]]+WHERE e\.oppdatert_tidspunkt IS NOT NULL[[:space:]]+ORDER BY'
  );
  PERFORM pg_temp.must(
    'removed enheter fetched latest scan',
    v_def !~ 'FROM reg\.enheter e[[:space:]]+WHERE e\.hentet_tidspunkt IS NOT NULL[[:space:]]+ORDER BY'
  );
  PERFORM pg_temp.must(
    'removed regnskap latest scans',
    v_def !~ 'FROM reg\.regnskap r[[:space:]]+WHERE r\.(hentet_tidspunkt|regnskapsaar) IS NOT NULL[[:space:]]+ORDER BY'
  );
  PERFORM pg_temp.must(
    'removed sync status latest scans',
    v_def !~ 'FROM reg\.regnskap_sync_status s[[:space:]]+WHERE s\.(latest_regnskapsaar|last_success_at|last_checked_at) IS NOT NULL[[:space:]]+ORDER BY'
  );
  PERFORM pg_temp.must(
    'removed source_postings latest scans',
    v_def !~ 'FROM public\.source_postings sp[[:space:]]+WHERE sp\.source = ''nav''[[:space:]]+(AND sp\.last_seen_at IS NOT NULL[[:space:]]+)?ORDER BY'
  );
  PERFORM pg_temp.must(
    'latest timestamp strategy is pg_stats',
    v_def LIKE '%pg_stats_histogram_upper_bound%'
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
    'count strategy says pg_stats timestamps',
    v_payload #>> '{count_strategy,latest_timestamps}' = 'pg_stats_histogram_upper_bound'
  );

  RAISE NOTICE 'Admin ingestion pg_stats timestamp tests PASS';
END
$tests$;

ROLLBACK;
