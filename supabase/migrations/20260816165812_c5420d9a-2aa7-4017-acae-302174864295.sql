-- Fase 3B: modellprofil + kjøringslogg-RPC for cv-atom-language-no.

INSERT INTO ai.model_profiles
  (profile_key, task_key, model_id, prompt_version, max_tokens, request_options, capabilities, cost_tier, is_active)
VALUES
  ('cv_atom_language_no_v1', 'cv_atom_language_no', 'claude-sonnet-4-6', '1.0.0', 8000,
   '{}'::jsonb,
   '{"supportsTemperature": false, "supportsTopP": false, "supportsTopK": false, "supportsThinking": false, "supportsPrefill": false}'::jsonb,
   'standard', true)
ON CONFLICT (profile_key) DO UPDATE
  SET task_key = EXCLUDED.task_key,
      model_id = EXCLUDED.model_id,
      prompt_version = EXCLUDED.prompt_version,
      max_tokens = EXCLUDED.max_tokens,
      request_options = EXCLUDED.request_options,
      capabilities = EXCLUDED.capabilities,
      is_active = true,
      updated_at = now();

CREATE OR REPLACE FUNCTION public.internal_ai_get_active_profile(p_task_key text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT pg_catalog.jsonb_build_object(
           'profile_id', p.id,
           'profile_key', p.profile_key,
           'task_key', p.task_key,
           'model_id', p.model_id,
           'prompt_version', p.prompt_version,
           'max_tokens', p.max_tokens,
           'request_options', p.request_options,
           'capabilities', p.capabilities,
           'cost_tier', p.cost_tier
         )
  FROM ai.model_profiles p
  WHERE p.task_key = p_task_key AND p.is_active
  ORDER BY p.updated_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.internal_ai_start_model_run(
  p_correlation_id uuid,
  p_user_id uuid,
  p_task_key text,
  p_model_id text,
  p_profile_id uuid DEFAULT NULL,
  p_profile_snapshot jsonb DEFAULT '{}'::jsonb,
  p_job_id uuid DEFAULT NULL,
  p_api_version text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO ai.model_runs
    (correlation_id, user_id, job_id, profile_id, profile_snapshot, task_key, model_id, api_version, status)
  VALUES
    (p_correlation_id, p_user_id, p_job_id, p_profile_id,
     pg_catalog.coalesce(p_profile_snapshot, '{}'::jsonb), p_task_key, p_model_id, p_api_version, 'running')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.internal_ai_finish_model_run(
  p_model_run_id uuid,
  p_status text,
  p_outcome text DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_http_status integer DEFAULT NULL,
  p_request_id text DEFAULT NULL,
  p_duration_ms integer DEFAULT NULL,
  p_retry_count integer DEFAULT 0,
  p_input_tokens integer DEFAULT NULL,
  p_output_tokens integer DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE ai.model_runs
     SET status = p_status,
         outcome = p_outcome,
         error_code = p_error_code,
         http_status = p_http_status,
         request_id = p_request_id,
         duration_ms = p_duration_ms,
         retry_count = pg_catalog.coalesce(p_retry_count, 0),
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         finished_at = pg_catalog.now()
   WHERE id = p_model_run_id;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT pg_catalog.format('public.%I(%s)', p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)) AS sig
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('internal_ai_get_active_profile','internal_ai_start_model_run','internal_ai_finish_model_run')
  LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;