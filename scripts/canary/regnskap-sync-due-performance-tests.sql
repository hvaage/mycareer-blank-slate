-- Regnskap sync due candidate performance postflight.
-- Run after 20260805132733_regnskap_sync_due_performance.sql and regnskap-sync deploy.
-- Read-only after migration: verifies required ready-queue index, first due
-- branch runtime and lock primitive.

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
  v_plan json;
  v_execution_ms numeric;
  v_lock_a boolean;
  v_lock_b boolean;
  v_unlock boolean;
BEGIN
  PERFORM pg_temp.must(
    'idx_rss_ready_pending_retry_due exists',
    to_regclass('reg.idx_rss_ready_pending_retry_due') IS NOT NULL
  );

  EXECUTE $explain$
    EXPLAIN (ANALYZE, FORMAT JSON)
    SELECT s.organisasjonsnummer
    FROM reg.regnskap_sync_status s
    JOIN reg.enheter e ON e.organisasjonsnummer = s.organisasjonsnummer
    WHERE coalesce(e.slettet,false)=false
      AND s.status IN ('pending','retry','due')
      AND coalesce(s.backoff_until, '-infinity'::timestamptz) <= now()
      AND coalesce(s.next_attempt_at, '-infinity'::timestamptz) <= now()
    ORDER BY coalesce(s.next_attempt_at, '-infinity'::timestamptz), s.last_checked_at ASC NULLS FIRST
    LIMIT 180
  $explain$ INTO v_plan;

  v_execution_ms := (v_plan -> 0 ->> 'Execution Time')::numeric;
  RAISE NOTICE 'ready due branch explain execution_ms=%', v_execution_ms;

  PERFORM pg_temp.must(
    'ready due branch completes under 5s',
    v_execution_ms < 5000
  );

  SELECT pg_try_advisory_lock(hashtextextended('regnskap-sync:global', 0))
  INTO v_lock_a;
  SELECT pg_try_advisory_lock(hashtextextended('regnskap-sync:global', 0))
  INTO v_lock_b;
  SELECT pg_advisory_unlock(hashtextextended('regnskap-sync:global', 0))
  INTO v_unlock;
  PERFORM pg_temp.must('first advisory lock acquisition succeeds', v_lock_a);
  PERFORM pg_temp.must('same session advisory lock reentry succeeds', v_lock_b);
  PERFORM pg_temp.must('advisory lock unlock succeeds', v_unlock);
  PERFORM pg_advisory_unlock(hashtextextended('regnskap-sync:global', 0));

  RAISE NOTICE 'Regnskap sync due performance tests PASS';
END
$tests$;

ROLLBACK;
