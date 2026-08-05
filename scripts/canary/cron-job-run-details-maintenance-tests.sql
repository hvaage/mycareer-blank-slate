-- Cron job_run_details maintenance canary.
-- Run after 20260805220037_cron_job_run_details_maintenance.sql.
-- The prune call is wrapped in ROLLBACK so this canary leaves no deletions.

BEGIN;
SET LOCAL statement_timeout = '10s';

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
  v_health record;
  v_prune record;
BEGIN
  PERFORM pg_temp.must(
    'health function exists',
    to_regprocedure('public.cron_job_run_details_health()') IS NOT NULL
  );
  PERFORM pg_temp.must(
    'prune function exists',
    to_regprocedure('public.prune_cron_job_run_details(integer,integer,integer)') IS NOT NULL
  );
  PERFORM pg_temp.must(
    'list_regnskap_cron_runs exists',
    to_regprocedure('public.list_regnskap_cron_runs(integer)') IS NOT NULL
  );

  PERFORM pg_temp.must(
    'anon cannot execute prune',
    NOT has_function_privilege('anon', 'public.prune_cron_job_run_details(integer,integer,integer)', 'EXECUTE')
  );
  PERFORM pg_temp.must(
    'authenticated cannot execute prune',
    NOT has_function_privilege('authenticated', 'public.prune_cron_job_run_details(integer,integer,integer)', 'EXECUTE')
  );
  PERFORM pg_temp.must(
    'service_role can execute prune',
    has_function_privilege('service_role', 'public.prune_cron_job_run_details(integer,integer,integer)', 'EXECUTE')
  );
  PERFORM pg_temp.must(
    'authenticated admin path can execute cron reader',
    has_function_privilege('authenticated', 'public.list_regnskap_cron_runs(integer)', 'EXECUTE')
  );

  SELECT * INTO v_health
  FROM public.cron_job_run_details_health();

  PERFORM pg_temp.must('health returns size estimate', v_health.total_bytes IS NOT NULL);

  SELECT * INTO v_prune
  FROM public.prune_cron_job_run_details(1000, 1, 1);

  PERFORM pg_temp.must('prune returns max_runid', v_prune.max_runid IS NOT NULL);
  PERFORM pg_temp.must('prune deletes at most requested rollback row', v_prune.deleted_count BETWEEN 0 AND 1);

  RAISE NOTICE 'Cron job_run_details maintenance tests PASS';
END
$tests$;

ROLLBACK;
