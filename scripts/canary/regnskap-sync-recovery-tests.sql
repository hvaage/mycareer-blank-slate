-- Regnskap sync recovery postflight.
-- Run after 20260805123352_regnskap_sync_recovery.sql and regnskap-sync deploy.
-- Read-only: verifies grants, stale lease cleanup and safe retry-backoff math.

BEGIN;

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
BEGIN
  PERFORM pg_temp.must(
    'list_regnskap_cron_runs exists',
    to_regprocedure('public.list_regnskap_cron_runs(integer)') IS NOT NULL
  );

  PERFORM pg_temp.must(
    'authenticated can execute admin-gated cron RPC',
    has_function_privilege('authenticated', 'public.list_regnskap_cron_runs(integer)', 'EXECUTE')
  );

  PERFORM pg_temp.must(
    'anon cannot execute cron RPC',
    NOT has_function_privilege('anon', 'public.list_regnskap_cron_runs(integer)', 'EXECUTE')
  );

  PERFORM pg_temp.must(
    'no stale in_progress rows remain',
    NOT EXISTS (
      SELECT 1
      FROM reg.regnskap_sync_status
      WHERE status = 'in_progress'
        AND COALESCE(last_checked_at, '-infinity'::timestamptz) < now() - interval '10 minutes'
    )
  );

  PERFORM pg_temp.must(
    'retry backoff expression is capped for pathological failure counts',
    (
      WITH failure_counts(consecutive_failures) AS (
        VALUES (0), (1), (5), (50), (1000000)
      ),
      backoffs AS (
        SELECT make_interval(mins => (
          LEAST(
            120::numeric,
            5::numeric * power(
              2::numeric,
              LEAST(GREATEST(COALESCE(consecutive_failures, 0), 0), 5)
            )
          )::integer
        )) AS retry_backoff
        FROM failure_counts
      )
      SELECT bool_and(retry_backoff >= interval '5 minutes' AND retry_backoff <= interval '2 hours')
      FROM backoffs
    )
  );

  RAISE NOTICE 'Regnskap sync recovery tests PASS';
END
$tests$;

ROLLBACK;
