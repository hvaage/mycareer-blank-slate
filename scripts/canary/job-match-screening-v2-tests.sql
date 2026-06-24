\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.must(p_label text, p_ok boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT coalesce(p_ok, false) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: %', p_label;
  END IF;
  RAISE NOTICE 'PASS: %', p_label;
END;
$$;

DO $tests$
DECLARE
  v_policy_count integer;
BEGIN
  PERFORM pg_temp.must(
    'canonical screening columns exist',
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user_opportunities'
        AND column_name = 'screening_status'
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user_opportunities'
        AND column_name = 'match_score_version'
    )
  );

  PERFORM pg_temp.must(
    'legacy screening columns exist',
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user_job_listing_status'
        AND column_name = 'screening_status'
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user_job_listing_status'
        AND column_name = 'match_score_version'
    )
  );

  PERFORM pg_temp.must(
    'authenticated can read only its evaluation history',
    has_table_privilege('authenticated', 'public.job_match_evaluations', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.job_match_evaluations', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.job_match_evaluations', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.job_match_evaluations', 'DELETE')
  );

  PERFORM pg_temp.must(
    'record RPC is service-role only',
    has_function_privilege(
      'service_role',
      'public.record_job_match_evaluation(uuid,text,uuid,jsonb,text,text,text,text)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.record_job_match_evaluation(uuid,text,uuid,jsonb,text,text,text,text)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.record_job_match_evaluation(uuid,text,uuid,jsonb,text,text,text,text)',
      'EXECUTE'
    )
  );

  PERFORM pg_temp.must(
    'record RPC has fixed security metadata',
    EXISTS (
      SELECT 1
      FROM pg_proc p
      WHERE p.oid = 'public.record_job_match_evaluation(uuid,text,uuid,jsonb,text,text,text,text)'::regprocedure
        AND p.prosecdef
        AND p.provolatile = 'v'
        AND p.proconfig @> ARRAY['search_path=public, pg_temp']::text[]
    )
  );

  SELECT count(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'job_match_evaluations'
    AND policyname = 'job_match_evaluations_select_own'
    AND cmd = 'SELECT'
    AND roles @> ARRAY['authenticated']::name[]
    AND qual = '(user_id = auth.uid())';
  PERFORM pg_temp.must(
    'evaluation history has own-row SELECT policy',
    v_policy_count = 1
  );

  PERFORM pg_temp.must(
    'history table has RLS enabled',
    EXISTS (
      SELECT 1 FROM pg_class c
      WHERE c.oid = 'public.job_match_evaluations'::regclass
        AND c.relrowsecurity
    )
  );

  RAISE NOTICE 'Job Match V2 read-only postflight PASS';
END;
$tests$;

ROLLBACK;
