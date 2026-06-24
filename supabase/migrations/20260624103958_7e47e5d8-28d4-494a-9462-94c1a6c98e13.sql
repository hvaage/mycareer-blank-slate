-- Transactional production canary for record_job_match_evaluation().
-- The inner exception block is a PostgreSQL subtransaction. Its deliberate
-- sentinel exception rolls back every canary write before the migration
-- continues, without DELETE cleanup or persistent test helpers.

DO $canary$
DECLARE
  v_before public.user_opportunities%ROWTYPE;
  v_after public.user_opportunities%ROWTYPE;
  v_eval public.job_match_evaluations%ROWTYPE;
  v_before_count bigint;
  v_after_count bigint;
  v_sentinel constant text := 'job_match_v2_canary_rollback';
BEGIN
  SELECT * INTO v_before
  FROM public.user_opportunities
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;

  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'job_match_v2_canary_requires_one_user_opportunity';
  END IF;

  SELECT count(*) INTO v_before_count
  FROM public.job_match_evaluations
  WHERE user_opportunity_id = v_before.id;

  BEGIN
    PERFORM public.record_job_match_evaluation(
      v_before.user_id,
      'canonical',
      v_before.id,
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

    IF NOT EXISTS (
      SELECT 1 FROM public.user_opportunities
      WHERE id = v_before.id AND user_id = v_before.user_id
        AND screening_status = 'excluded'
        AND match_score_version = 'job_match_v2_canary'
        AND ai_score = 0
    ) THEN
      RAISE EXCEPTION 'job_match_v2_canary_writer_assertion_failed';
    END IF;

    SELECT count(*) INTO v_after_count
    FROM public.job_match_evaluations
    WHERE user_opportunity_id = v_before.id;
    IF v_after_count <> v_before_count + 1 THEN
      RAISE EXCEPTION 'job_match_v2_canary_history_count_failed';
    END IF;

    SELECT * INTO v_eval
    FROM public.job_match_evaluations
    WHERE user_opportunity_id = v_before.id
    ORDER BY created_at DESC
    LIMIT 1;
    IF v_eval.previous_result->'score' IS DISTINCT FROM coalesce(to_jsonb(v_before.ai_score), 'null'::jsonb)
       OR v_eval.previous_result->>'score_version' IS DISTINCT FROM v_before.match_score_version THEN
      RAISE EXCEPTION 'job_match_v2_canary_previous_result_failed';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0004', MESSAGE = v_sentinel;
  EXCEPTION
    WHEN SQLSTATE 'P0004' THEN
      IF SQLERRM <> v_sentinel THEN
        RAISE;
      END IF;
  END;

  SELECT * INTO v_after
  FROM public.user_opportunities
  WHERE id = v_before.id;
  SELECT count(*) INTO v_after_count
  FROM public.job_match_evaluations
  WHERE user_opportunity_id = v_before.id;

  IF to_jsonb(v_after) IS DISTINCT FROM to_jsonb(v_before) THEN
    RAISE EXCEPTION 'job_match_v2_canary_row_not_rolled_back';
  END IF;
  IF v_after_count <> v_before_count THEN
    RAISE EXCEPTION 'job_match_v2_canary_history_not_rolled_back';
  END IF;

  RAISE NOTICE 'PASS: job match writer, history and rollback invariants';
END;
$canary$;