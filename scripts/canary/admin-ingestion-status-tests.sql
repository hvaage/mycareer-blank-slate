-- Admin ingestion status contract tests.
-- Run as postgres/operator after applying 20260627120000_admin_ingestion_status.sql.
-- All writes are rolled back; the target function is read-only.

BEGIN;

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
  v_before_nav bigint;
  v_before_nav_runs bigint;
  v_before_enheter bigint;
  v_before_regnskap bigint;
  v_payload jsonb;
  v_daily jsonb;
BEGIN
  SELECT count(*) INTO v_before_nav FROM public.source_postings;
  SELECT count(*) INTO v_before_nav_runs FROM public.nav_sync_runs;
  SELECT count(*) INTO v_before_enheter FROM reg.enheter;
  SELECT count(*) INTO v_before_regnskap FROM reg.regnskap;

  v_payload := public.get_admin_ingestion_status(3, 'Europe/Oslo');
  v_daily := v_payload #> '{nav,daily_new_unique_postings}';

  PERFORM pg_temp.must('payload is object', jsonb_typeof(v_payload) = 'object');
  PERFORM pg_temp.must('has generated_at', v_payload ? 'generated_at');
  PERFORM pg_temp.must('has brreg', v_payload ? 'brreg');
  PERFORM pg_temp.must('has nav', v_payload ? 'nav');
  PERFORM pg_temp.must('window days preserved', (v_payload #>> '{window,days}')::integer = 3);
  PERFORM pg_temp.must('daily NAV array exists', jsonb_typeof(v_daily) = 'array');
  PERFORM pg_temp.must('daily NAV array has requested days', jsonb_array_length(v_daily) = 3);
  PERFORM pg_temp.must(
    'regnskap remaining estimate is present',
    v_payload #>> '{brreg,regnskapsregisteret,remaining_estimate_kind}'
      = 'local_enhetsregisteret_without_regnskap_row'
  );
  PERFORM pg_temp.must(
    'NAV active unique count is numeric',
    (v_payload #>> '{nav,active_unique_postings}') ~ '^[0-9]+$'
  );

  PERFORM pg_temp.must(
    'source_postings count unchanged',
    (SELECT count(*) FROM public.source_postings) = v_before_nav
  );
  PERFORM pg_temp.must(
    'nav_sync_runs count unchanged',
    (SELECT count(*) FROM public.nav_sync_runs) = v_before_nav_runs
  );
  PERFORM pg_temp.must(
    'reg.enheter count unchanged',
    (SELECT count(*) FROM reg.enheter) = v_before_enheter
  );
  PERFORM pg_temp.must(
    'reg.regnskap count unchanged',
    (SELECT count(*) FROM reg.regnskap) = v_before_regnskap
  );

  RAISE NOTICE 'Admin ingestion status tests PASS';
END
$tests$;

ROLLBACK;
