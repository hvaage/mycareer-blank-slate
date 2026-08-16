-- COALESCE/GREATEST/LEAST er SQL-konstruksjoner, ikke skjema-kvalifiserbare funksjoner.
CREATE OR REPLACE FUNCTION public.internal_ai_enqueue_job(
  p_user_id uuid,
  p_document_group_id uuid,
  p_job_kind text,
  p_input jsonb DEFAULT '{}'::jsonb,
  p_profile_id uuid DEFAULT NULL,
  p_opportunity_id uuid DEFAULT NULL,
  p_priority smallint DEFAULT 500,
  p_step_budget_ms integer DEFAULT 90000,
  p_max_attempts integer DEFAULT 3,
  p_rate_limit_per_hour integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_recent integer; v_id uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('cv_generation_jobs_enqueue:' || p_user_id::text)
  );

  SELECT pg_catalog.count(*) INTO v_recent
  FROM public.cv_generation_jobs
  WHERE user_id = p_user_id AND created_at > pg_catalog.now() - interval '1 hour';

  IF v_recent >= p_rate_limit_per_hour THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error_code', 'rate_limited', 'retry_after_seconds', 3600);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cv_generation_jobs
    WHERE user_id = p_user_id AND document_group_id = p_document_group_id
      AND status IN ('queued','running','waiting_review')
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error_code', 'active_job_exists');
  END IF;

  INSERT INTO public.cv_generation_jobs
    (user_id, document_group_id, job_kind, input_payload, profile_id, opportunity_id,
     priority, step_budget_ms, lease_seconds, max_attempts)
  VALUES
    (p_user_id, p_document_group_id, p_job_kind, COALESCE(p_input, '{}'::jsonb),
     p_profile_id, p_opportunity_id, p_priority, p_step_budget_ms,
     GREATEST(180, (2 * p_step_budget_ms) / 1000), p_max_attempts)
  RETURNING id INTO v_id;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'job_id', v_id, 'status', 'queued');
END $$;

CREATE OR REPLACE FUNCTION public.internal_ai_complete_job(
  p_job_id uuid, p_worker_id text, p_status text,
  p_result jsonb DEFAULT NULL, p_model_run_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF p_status NOT IN ('succeeded','waiting_review','cancelled') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error_code', 'invalid_status');
  END IF;

  UPDATE public.cv_generation_jobs j
     SET status = p_status,
         result_payload = COALESCE(p_result, j.result_payload),
         model_run_id = COALESCE(p_model_run_id, j.model_run_id),
         locked_by = NULL, locked_at = NULL, lease_expires_at = NULL,
         finished_at = CASE WHEN p_status IN ('succeeded','cancelled') THEN pg_catalog.now() ELSE NULL END,
         error_code = NULL, last_error = NULL,
         updated_at = pg_catalog.now()
   WHERE j.id = p_job_id AND j.status = 'running' AND j.locked_by = p_worker_id
  RETURNING j.id INTO v_id;

  IF v_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error_code', 'lease_lost');
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'job_id', v_id, 'status', p_status);
END $$;

CREATE OR REPLACE FUNCTION public.internal_ai_requeue_job(
  p_job_id uuid, p_worker_id text, p_error_code text, p_error text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job public.cv_generation_jobs%ROWTYPE; v_delay integer;
BEGIN
  SELECT * INTO v_job FROM public.cv_generation_jobs
   WHERE id = p_job_id AND status = 'running' AND locked_by = p_worker_id FOR UPDATE;

  IF v_job.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error_code', 'lease_lost');
  END IF;

  IF v_job.attempt_count >= v_job.max_attempts THEN
    UPDATE public.cv_generation_jobs
       SET status = 'failed', locked_by = NULL, locked_at = NULL, lease_expires_at = NULL,
           error_code = p_error_code, last_error = p_error,
           finished_at = pg_catalog.now(), updated_at = pg_catalog.now()
     WHERE id = p_job_id;
    RETURN pg_catalog.jsonb_build_object('ok', true, 'job_id', p_job_id, 'status', 'failed', 'reason', 'max_attempts');
  END IF;

  v_delay := LEAST(900, (30 * (2 ^ (v_job.attempt_count - 1)))::integer);

  UPDATE public.cv_generation_jobs
     SET status = 'queued', locked_by = NULL, locked_at = NULL, lease_expires_at = NULL,
         run_after = pg_catalog.now() + (v_delay || ' seconds')::interval,
         error_code = p_error_code, last_error = p_error, updated_at = pg_catalog.now()
   WHERE id = p_job_id;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'job_id', p_job_id, 'status', 'queued', 'retry_in_seconds', v_delay);
END $$;

CREATE OR REPLACE FUNCTION public.internal_ai_reap_stale_jobs(
  p_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_requeued integer := 0; v_failed integer := 0; v_runs integer := 0;
BEGIN
  WITH stale AS (
    SELECT id, attempt_count, max_attempts, model_run_id
      FROM public.cv_generation_jobs
     WHERE status = 'running' AND lease_expires_at < pg_catalog.now()
     ORDER BY lease_expires_at ASC LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  ), failed AS (
    UPDATE public.cv_generation_jobs j
       SET status = 'failed', locked_by = NULL, locked_at = NULL, lease_expires_at = NULL,
           error_code = 'lease_expired', last_error = 'Jobben svarte ikke innen leieperioden.',
           finished_at = pg_catalog.now(), updated_at = pg_catalog.now()
      FROM stale s
     WHERE j.id = s.id AND s.attempt_count >= s.max_attempts
    RETURNING j.id
  ), requeued AS (
    UPDATE public.cv_generation_jobs j
       SET status = 'queued', locked_by = NULL, locked_at = NULL, lease_expires_at = NULL,
           run_after = pg_catalog.now() + (LEAST(900, (30 * (2 ^ GREATEST(s.attempt_count - 1, 0)))::integer) || ' seconds')::interval,
           error_code = 'lease_expired', updated_at = pg_catalog.now()
      FROM stale s
     WHERE j.id = s.id AND s.attempt_count < s.max_attempts
    RETURNING j.id
  ), cancelled_runs AS (
    UPDATE ai.model_runs r
       SET status = 'cancelled', outcome = 'cancelled', finished_at = pg_catalog.now()
     WHERE r.status = 'running'
       AND r.job_id IN (SELECT id FROM stale)
    RETURNING r.id
  )
  SELECT (SELECT pg_catalog.count(*) FROM requeued),
         (SELECT pg_catalog.count(*) FROM failed),
         (SELECT pg_catalog.count(*) FROM cancelled_runs)
    INTO v_requeued, v_failed, v_runs;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'requeued', v_requeued, 'failed', v_failed, 'cancelled_model_runs', v_runs);
END $$;

DO $grants$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'internal\_ai\_%'
  LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $grants$;