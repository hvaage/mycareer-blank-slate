-- Regnskap sync catchup cron canary.
-- Run after 20260805184332_regnskap_sync_cron_delivery_relief.sql.
-- Read-only: verifies the pg_cron job schedule and request body.

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
DECLARE
  v_jobid bigint;
  v_schedule text;
  v_active boolean;
  v_command text;
BEGIN
  SELECT jobid, schedule, active, command
  INTO v_jobid, v_schedule, v_active, v_command
  FROM cron.job
  WHERE jobname = 'regnskap-sync-nightly';

  PERFORM pg_temp.must('regnskap-sync-nightly exists', v_jobid IS NOT NULL);
  PERFORM pg_temp.must('catchup schedule every 15 minutes, offset from NAV/Careerjet', v_schedule = '13,28,43,58 * * * *');
  PERFORM pg_temp.must('cron is active', v_active IS TRUE);
  PERFORM pg_temp.must('calls regnskap-sync edge function', v_command LIKE '%/functions/v1/regnskap-sync%');
  PERFORM pg_temp.must('uses due mode', v_command LIKE '%"mode": "due"%');
  PERFORM pg_temp.must('uses catchup limit 60', v_command LIKE '%"limit": 60%');
  PERFORM pg_temp.must('uses max runner rps 2', v_command LIKE '%"rps": 2%');
  PERFORM pg_temp.must('uses max runner time budget', v_command LIKE '%"timeBudgetMs": 55000%');
  PERFORM pg_temp.must('skips optional PDF-year fetches', v_command LIKE '%"includePdfYears": false%');
  PERFORM pg_temp.must('marks catchup profile', v_command LIKE '%"profile": "catchup_min_1_year"%');
  PERFORM pg_temp.must('marks relief delivery profile', v_command LIKE '%"deliveryProfile": "relief_15m_offset"%');
  PERFORM pg_temp.must('uses pg_net timeout override', v_command LIKE '%timeout_milliseconds := 150000%');

  RAISE NOTICE 'Regnskap sync catchup cron tests PASS';
END
$tests$;

ROLLBACK;
