-- Admin ingestion status ultrafast canary.
-- Run after 20260630143000_admin_ingestion_status_ultrafast.sql.
-- Read-only: verifies payload shape and the no-full-sync-status-scan strategy.

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
BEGIN
  v_payload := public.get_admin_ingestion_status(14, 'Europe/Oslo');
  v_daily := v_payload #> '{nav,daily_new_unique_postings}';

  PERFORM pg_temp.must('payload is object', jsonb_typeof(v_payload) = 'object');
  PERFORM pg_temp.must('has count strategy', v_payload ? 'count_strategy');
  PERFORM pg_temp.must(
    'regnskap sync status counts use estimates',
    v_payload #>> '{count_strategy,regnskap_sync_status_counts}' = 'partial_index_estimate'
  );
  PERFORM pg_temp.must(
    'due now uses bounded estimate',
    v_payload #>> '{count_strategy,regnskap_due_now}' = 'missing_plus_pending_due_retry_stuck_estimate'
  );
  PERFORM pg_temp.must('has brreg', v_payload ? 'brreg');
  PERFORM pg_temp.must('has nav', v_payload ? 'nav');
  PERFORM pg_temp.must('window days preserved', (v_payload #>> '{window,days}')::integer = 14);
  PERFORM pg_temp.must('daily NAV array exists', jsonb_typeof(v_daily) = 'array');
  PERFORM pg_temp.must('daily NAV array has requested days', jsonb_array_length(v_daily) = 14);
  PERFORM pg_temp.must(
    'by_status is object',
    jsonb_typeof(v_payload #> '{brreg,regnskap_sync,by_status}') = 'object'
  );
  PERFORM pg_temp.must(
    'by_status is marked estimate',
    (v_payload #>> '{brreg,regnskap_sync,by_status_is_estimate}')::boolean IS TRUE
  );
  PERFORM pg_temp.must(
    'NAV active unique count is numeric',
    (v_payload #>> '{nav,active_unique_postings}') ~ '^[0-9]+$'
  );

  RAISE NOTICE 'Admin ingestion status ultrafast tests PASS';
END
$tests$;

ROLLBACK;
