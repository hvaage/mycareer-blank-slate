-- Admin ingestion status fast-path canary.
-- Run after 20260630103000_admin_ingestion_status_fast_path.sql.
-- The short statement timeout mirrors the UI/PostgREST failure mode.

BEGIN;

SET LOCAL statement_timeout = '7000ms';
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
    'large mirror counts use fast strategy',
    v_payload #>> '{count_strategy,large_mirror_counts}' = 'planner_estimate'
  );
  PERFORM pg_temp.must('has brreg', v_payload ? 'brreg');
  PERFORM pg_temp.must('has nav', v_payload ? 'nav');
  PERFORM pg_temp.must('window days preserved', (v_payload #>> '{window,days}')::integer = 14);
  PERFORM pg_temp.must('daily NAV array exists', jsonb_typeof(v_daily) = 'array');
  PERFORM pg_temp.must('daily NAV array has requested days', jsonb_array_length(v_daily) = 14);
  PERFORM pg_temp.must(
    'remaining estimate kind updated',
    v_payload #>> '{brreg,regnskapsregisteret,remaining_estimate_kind}'
      = 'local_enhetsregisteret_estimate_minus_regnskap_sync_success_rows'
  );
  PERFORM pg_temp.must(
    'NAV active unique count is numeric',
    (v_payload #>> '{nav,active_unique_postings}') ~ '^[0-9]+$'
  );

  RAISE NOTICE 'Admin ingestion status fast-path tests PASS';
END
$tests$;

ROLLBACK;
