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
  v_uo public.user_opportunities%ROWTYPE;
  v_before_evaluations bigint;
  v_after_evaluations bigint;
  v_eval public.job_match_evaluations%ROWTYPE;
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

  SELECT * INTO v_uo
  FROM public.user_opportunities
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;
  PERFORM pg_temp.must('canonical canary row exists', v_uo.id IS NOT NULL);

  SELECT count(*) INTO v_before_evaluations
  FROM public.job_match_evaluations
  WHERE user_opportunity_id = v_uo.id;

  PERFORM public.record_job_match_evaluation(
    v_uo.user_id,
    'canonical',
    v_uo.id,
    jsonb_build_object(
      'screening_status', 'excluded',
      'screening_reasons', jsonb_build_array(jsonb_build_object(
        'code', 'canary_hard_filter',
        'label', 'Canary',
        'severity', 'hard_filter'
      )),
      'requirement_summary', jsonb_build_object('parser_version', 'canary'),
      'score', 0,
      'reasoning', 'Canary',
      'match_highlights', '',
      'concerns', 'Canary'
    ),
    'job_match_v2_canary',
    'deterministic_canary',
    'profile_hash_canary',
    'job_hash_canary'
  );

  PERFORM pg_temp.must(
    'canonical result is replaced atomically',
    EXISTS (
      SELECT 1 FROM public.user_opportunities
      WHERE id = v_uo.id AND user_id = v_uo.user_id
        AND screening_status = 'excluded'
        AND match_score_version = 'job_match_v2_canary'
        AND ai_score = 0
    )
  );

  SELECT count(*) INTO v_after_evaluations
  FROM public.job_match_evaluations
  WHERE user_opportunity_id = v_uo.id;
  PERFORM pg_temp.must(
    'one append-only history row is written',
    v_after_evaluations = v_before_evaluations + 1
  );

  SELECT * INTO v_eval
  FROM public.job_match_evaluations
  WHERE user_opportunity_id = v_uo.id
  ORDER BY created_at DESC
  LIMIT 1;
  PERFORM pg_temp.must(
    'history preserves previous result',
    v_eval.previous_result->'score' IS NOT DISTINCT FROM to_jsonb(v_uo.ai_score)
    AND v_eval.previous_result->>'score_version' IS NOT DISTINCT FROM v_uo.match_score_version
  );

  RAISE NOTICE 'Job Match V2 schema/RPC canary PASS';
END;
$tests$;

ROLLBACK;
