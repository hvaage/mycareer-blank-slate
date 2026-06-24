\set ON_ERROR_STOP on

BEGIN;

DO $canary$
DECLARE
  v_user_id uuid;
  v_source text;
  v_count bigint;
  v_attempt integer;
  v_started_at timestamptz;
  v_elapsed_ms numeric;
BEGIN
  SELECT candidate.user_id
  INTO v_user_id
  FROM (
    SELECT user_id FROM public.user_opportunities
    UNION
    SELECT user_id FROM public.user_job_listing_status
    UNION
    SELECT user_id FROM public.job_leads
  ) candidate
  WHERE candidate.user_id IS NOT NULL
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No user with job opportunity data found for canary';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user_id, 'role', 'authenticated')::text,
    true
  );

  FOREACH v_source IN ARRAY ARRAY['linkedin', 'nav', 'careerjet']::text[]
  LOOP
    v_started_at := clock_timestamp();

    SELECT count(*)
    INTO v_count
    FROM public.list_user_job_opportunities('new', v_source);

    v_elapsed_ms := round(
      extract(epoch FROM (clock_timestamp() - v_started_at))::numeric * 1000,
      1
    );

    RAISE NOTICE 'PASS source=% rows=% duration_ms=%', v_source, v_count, v_elapsed_ms;
  END LOOP;

  FOR v_attempt IN 1..3
  LOOP
    v_started_at := clock_timestamp();

    SELECT count(*)
    INTO v_count
    FROM public.list_user_job_opportunities('new', 'all');

    v_elapsed_ms := round(
      extract(epoch FROM (clock_timestamp() - v_started_at))::numeric * 1000,
      1
    );

    RAISE NOTICE 'PASS source=all attempt=% rows=% duration_ms=%',
      v_attempt,
      v_count,
      v_elapsed_ms;
  END LOOP;
END;
$canary$;

ROLLBACK;
