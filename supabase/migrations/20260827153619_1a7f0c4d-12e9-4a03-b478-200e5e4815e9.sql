ALTER TABLE public.network_activity_suggestion_runs
  ADD COLUMN IF NOT EXISTS focus text;

ALTER TABLE public.network_activity_suggestion_runs
  DROP CONSTRAINT IF EXISTS network_activity_suggestion_runs_focus_check;
ALTER TABLE public.network_activity_suggestion_runs
  ADD CONSTRAINT network_activity_suggestion_runs_focus_check
  CHECK (focus IS NULL OR focus IN ('nettverk','oppfolging','soknad','alle'));

DROP FUNCTION IF EXISTS public.network_enqueue_suggestion_run(uuid, text, uuid, text, boolean, text, text);

CREATE OR REPLACE FUNCTION public.network_enqueue_suggestion_run(
  p_user_id uuid, p_scope text, p_scope_object_id uuid, p_signature_base text,
  p_regenerate boolean, p_model_profile text, p_prompt_version text,
  p_focus text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key text;
  v_epoch integer;
  v_signature text;
  v_focus text;
  v_run public.network_activity_suggestion_runs%ROWTYPE;
  v_recent integer;
  v_active integer;
BEGIN
  IF p_user_id IS NULL OR p_scope IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_input');
  END IF;
  IF p_scope NOT IN ('overview','company','contact','opportunity') THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_scope');
  END IF;
  IF NOT public.network_suggestion_scope_owned(p_user_id, p_scope, p_scope_object_id) THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_scope');
  END IF;

  v_focus := CASE WHEN p_focus IN ('nettverk','oppfolging','soknad','alle') THEN p_focus ELSE NULL END;

  v_key := public.network_suggestion_scope_key(p_scope, p_scope_object_id);

  INSERT INTO public.network_activity_suggestion_scope_state
    (user_id, scope, scope_object_id, scope_key, generation_epoch)
  VALUES (p_user_id, p_scope, p_scope_object_id, v_key, 0)
  ON CONFLICT (user_id, scope_key) DO UPDATE
    SET generation_epoch = public.network_activity_suggestion_scope_state.generation_epoch
        + CASE WHEN COALESCE(p_regenerate, false) THEN 1 ELSE 0 END,
        updated_at = now()
  RETURNING generation_epoch INTO v_epoch;

  v_signature := md5(coalesce(p_signature_base,'') || ':' || p_model_profile || ':'
                     || p_prompt_version || ':' || v_epoch::text || ':' || coalesce(v_focus,''));

  SELECT * INTO v_run FROM public.network_activity_suggestion_runs r
   WHERE r.user_id = p_user_id
     AND r.input_signature = v_signature
     AND r.status IN ('queued','running','succeeded')
   LIMIT 1;

  IF v_run.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'reused', true, 'run_id', v_run.id,
                              'status', v_run.status, 'generation_epoch', v_epoch);
  END IF;

  SELECT count(*) INTO v_recent FROM public.network_activity_suggestion_runs r
   WHERE r.user_id = p_user_id AND r.created_at > now() - interval '1 hour';
  IF v_recent >= 6 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'rate_limited');
  END IF;

  SELECT count(*) INTO v_active FROM public.network_activity_suggestion_runs r
   WHERE r.user_id = p_user_id AND r.status IN ('queued','running');
  IF v_active >= 2 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'too_many_active');
  END IF;

  INSERT INTO public.network_activity_suggestion_runs
    (user_id, scope, scope_object_id, scope_key, generation_epoch, input_signature,
     model_profile, prompt_version, focus)
  VALUES (p_user_id, p_scope, p_scope_object_id, v_key, v_epoch, v_signature,
          p_model_profile, p_prompt_version, v_focus)
  RETURNING * INTO v_run;

  RETURN jsonb_build_object('ok', true, 'reused', false, 'run_id', v_run.id,
                            'status', v_run.status, 'generation_epoch', v_epoch);
END $function$;

REVOKE ALL ON FUNCTION public.network_enqueue_suggestion_run(uuid, text, uuid, text, boolean, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.network_enqueue_suggestion_run(uuid, text, uuid, text, boolean, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.network_claim_suggestion_run(p_lease_owner text, p_lease_seconds integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_run public.network_activity_suggestion_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.network_activity_suggestion_runs r
   WHERE r.status = 'queued' AND r.next_attempt_at <= now()
   ORDER BY r.created_at
   FOR UPDATE SKIP LOCKED
   LIMIT 1;
  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'run', NULL);
  END IF;

  UPDATE public.network_activity_suggestion_runs
     SET status = 'running', lease_owner = p_lease_owner,
         lease_expires_at = now() + make_interval(secs => GREATEST(p_lease_seconds, 30)),
         heartbeat_at = now(),
         started_at = COALESCE(started_at, now()),
         attempt_count = attempt_count + 1
   WHERE id = v_run.id
   RETURNING * INTO v_run;

  RETURN jsonb_build_object('ok', true, 'run', jsonb_build_object(
    'id', v_run.id, 'user_id', v_run.user_id, 'scope', v_run.scope,
    'scope_object_id', v_run.scope_object_id, 'scope_key', v_run.scope_key,
    'focus', v_run.focus,
    'generation_epoch', v_run.generation_epoch, 'correlation_id', v_run.correlation_id,
    'model_profile', v_run.model_profile, 'prompt_version', v_run.prompt_version,
    'attempt_count', v_run.attempt_count));
END $function$;

REVOKE ALL ON FUNCTION public.network_claim_suggestion_run(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.network_claim_suggestion_run(text, integer) TO service_role;