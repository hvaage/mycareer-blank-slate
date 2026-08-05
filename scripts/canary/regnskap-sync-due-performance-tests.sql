-- Regnskap sync due candidate performance postflight.
-- Run after 20260805132733_regnskap_sync_due_performance.sql and regnskap-sync deploy.
-- Read-only after migration: verifies indexes, due candidate plan runtime and lock primitive.

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
  v_missing_status bigint;
  v_lock_a boolean;
  v_lock_b boolean;
  v_unlock boolean;
BEGIN
  PERFORM pg_temp.must(
    'idx_rss_ok_next_attempt exists',
    to_regclass('reg.idx_rss_ok_next_attempt') IS NOT NULL
  );
  PERFORM pg_temp.must(
    'idx_rss_ok_last_success exists',
    to_regclass('reg.idx_rss_ok_last_success') IS NOT NULL
  );
  PERFORM pg_temp.must(
    'idx_rss_no_regnskap_checked exists',
    to_regclass('reg.idx_rss_no_regnskap_checked') IS NOT NULL
  );
  PERFORM pg_temp.must(
    'idx_rss_not_found_checked exists',
    to_regclass('reg.idx_rss_not_found_checked') IS NOT NULL
  );
  PERFORM pg_temp.must(
    'idx_rss_in_progress_checked exists',
    to_regclass('reg.idx_rss_in_progress_checked') IS NOT NULL
  );

  SELECT count(*)::bigint
  INTO v_missing_status
  FROM reg.enheter e
  WHERE COALESCE(e.slettet, false) = false
    AND NOT EXISTS (
      SELECT 1
      FROM reg.regnskap_sync_status s
      WHERE s.organisasjonsnummer = e.organisasjonsnummer
    );

  PERFORM pg_temp.must(
    'active enheter have status rows after migration',
    v_missing_status = 0
  );

  EXECUTE $explain$
    EXPLAIN (ANALYZE, FORMAT JSON)
    WITH candidate_pool AS (
      (
        SELECT s.organisasjonsnummer, s.last_checked_at, 10 AS priority
        FROM reg.regnskap_sync_status s
        JOIN reg.enheter e ON e.organisasjonsnummer = s.organisasjonsnummer
        WHERE coalesce(e.slettet,false)=false
          AND s.status IN ('pending','retry','due')
          AND coalesce(s.backoff_until, '-infinity'::timestamptz) <= now()
          AND coalesce(s.next_attempt_at, '-infinity'::timestamptz) <= now()
        ORDER BY coalesce(s.next_attempt_at, '-infinity'::timestamptz), s.last_checked_at ASC NULLS FIRST
        LIMIT 180
      )
      UNION ALL
      (
        SELECT s.organisasjonsnummer, s.last_checked_at, 20 AS priority
        FROM reg.regnskap_sync_status s
        JOIN reg.enheter e ON e.organisasjonsnummer = s.organisasjonsnummer
        WHERE coalesce(e.slettet,false)=false
          AND s.status = 'ok'
          AND s.next_attempt_at <= now()
        ORDER BY s.next_attempt_at, s.last_checked_at ASC NULLS FIRST
        LIMIT 180
      )
      UNION ALL
      (
        SELECT s.organisasjonsnummer, s.last_checked_at, 30 AS priority
        FROM reg.regnskap_sync_status s
        JOIN reg.enheter e ON e.organisasjonsnummer = s.organisasjonsnummer
        WHERE coalesce(e.slettet,false)=false
          AND s.status = 'ok'
          AND s.last_success_at < now() - interval '180 days'
        ORDER BY s.last_success_at ASC NULLS FIRST
        LIMIT 180
      )
      UNION ALL
      (
        SELECT s.organisasjonsnummer, s.last_checked_at, 40 AS priority
        FROM reg.regnskap_sync_status s
        JOIN reg.enheter e ON e.organisasjonsnummer = s.organisasjonsnummer
        WHERE coalesce(e.slettet,false)=false
          AND s.status = 'no_regnskap'
          AND s.last_checked_at < now() - interval '90 days'
        ORDER BY s.last_checked_at ASC NULLS FIRST
        LIMIT 180
      )
      UNION ALL
      (
        SELECT s.organisasjonsnummer, s.last_checked_at, 50 AS priority
        FROM reg.regnskap_sync_status s
        JOIN reg.enheter e ON e.organisasjonsnummer = s.organisasjonsnummer
        WHERE coalesce(e.slettet,false)=false
          AND s.status = 'not_found'
          AND s.last_checked_at < now() - interval '180 days'
        ORDER BY s.last_checked_at ASC NULLS FIRST
        LIMIT 180
      )
      UNION ALL
      (
        SELECT s.organisasjonsnummer, s.last_checked_at, 60 AS priority
        FROM reg.regnskap_sync_status s
        JOIN reg.enheter e ON e.organisasjonsnummer = s.organisasjonsnummer
        WHERE coalesce(e.slettet,false)=false
          AND s.status = 'in_progress'
          AND s.last_checked_at < now() - interval '10 minutes'
        ORDER BY s.last_checked_at ASC NULLS FIRST
        LIMIT 180
      )
    ),
    deduped AS (
      SELECT DISTINCT ON (organisasjonsnummer)
        organisasjonsnummer, priority, last_checked_at
      FROM candidate_pool
      ORDER BY organisasjonsnummer, priority, last_checked_at ASC NULLS FIRST
    )
    SELECT organisasjonsnummer
    FROM deduped
    ORDER BY priority, last_checked_at ASC NULLS FIRST
    LIMIT 180
  $explain$ INTO v_plan;

  v_execution_ms := (v_plan -> 0 ->> 'Execution Time')::numeric;
  RAISE NOTICE 'due candidate explain execution_ms=%', v_execution_ms;

  PERFORM pg_temp.must(
    'due candidate query completes under 5s',
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
