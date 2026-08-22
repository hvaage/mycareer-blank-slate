-- Fase 5D: kanoniske serverhandlinger for KI-aktivitetsforslag

CREATE OR REPLACE FUNCTION public.network_suggestion_scope_key(p_scope text, p_scope_object_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN p_scope = 'overview' THEN 'overview'
              ELSE p_scope || ':' || p_scope_object_id::text END;
$$;

CREATE OR REPLACE FUNCTION public.network_suggestion_scope_owned(
  p_user_id uuid, p_scope text, p_scope_object_id uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_scope = 'overview' THEN
    RETURN p_scope_object_id IS NULL;
  END IF;
  IF p_scope_object_id IS NULL THEN RETURN false; END IF;

  IF p_scope = 'company' THEN
    RETURN EXISTS (SELECT 1 FROM public.user_company_relationships r
                    WHERE r.user_id = p_user_id AND r.company_id = p_scope_object_id)
        OR EXISTS (SELECT 1 FROM public.network_contact_company_relations r
                    WHERE r.user_id = p_user_id AND r.company_id = p_scope_object_id);
  ELSIF p_scope = 'contact' THEN
    RETURN EXISTS (SELECT 1 FROM public.network_contacts c
                    WHERE c.user_id = p_user_id AND c.id = p_scope_object_id);
  ELSIF p_scope = 'opportunity' THEN
    RETURN EXISTS (SELECT 1 FROM public.user_opportunities o
                    WHERE o.user_id = p_user_id AND o.id = p_scope_object_id);
  END IF;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.network_enqueue_suggestion_run(
  p_user_id uuid,
  p_scope text,
  p_scope_object_id uuid,
  p_signature_base text,
  p_regenerate boolean,
  p_model_profile text,
  p_prompt_version text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text;
  v_epoch integer;
  v_signature text;
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
                     || p_prompt_version || ':' || v_epoch::text);

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
     model_profile, prompt_version)
  VALUES (p_user_id, p_scope, p_scope_object_id, v_key, v_epoch, v_signature,
          p_model_profile, p_prompt_version)
  RETURNING * INTO v_run;

  RETURN jsonb_build_object('ok', true, 'reused', false, 'run_id', v_run.id,
                            'status', v_run.status, 'generation_epoch', v_epoch);
END $$;

CREATE OR REPLACE FUNCTION public.network_claim_suggestion_run(
  p_lease_owner text, p_lease_seconds integer DEFAULT 300
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    'generation_epoch', v_run.generation_epoch, 'correlation_id', v_run.correlation_id,
    'model_profile', v_run.model_profile, 'prompt_version', v_run.prompt_version,
    'attempt_count', v_run.attempt_count));
END $$;

CREATE OR REPLACE FUNCTION public.network_heartbeat_suggestion_run(
  p_run_id uuid, p_lease_owner text, p_lease_seconds integer DEFAULT 300
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.network_activity_suggestion_runs
     SET heartbeat_at = now(),
         lease_expires_at = now() + make_interval(secs => GREATEST(p_lease_seconds, 30))
   WHERE id = p_run_id AND lease_owner = p_lease_owner AND status = 'running';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_count = 1);
END $$;

CREATE OR REPLACE FUNCTION public.network_finish_suggestion_run(
  p_run_id uuid,
  p_lease_owner text,
  p_status text,
  p_error_code text DEFAULT NULL,
  p_model_run_id uuid DEFAULT NULL,
  p_model_name text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run public.network_activity_suggestion_runs%ROWTYPE;
  v_item jsonb;
  v_count integer := 0;
BEGIN
  SELECT * INTO v_run FROM public.network_activity_suggestion_runs
   WHERE id = p_run_id AND lease_owner = p_lease_owner AND status = 'running'
   FOR UPDATE;
  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'lease_lost');
  END IF;

  IF p_status = 'retry' THEN
    IF v_run.attempt_count >= 3 THEN
      UPDATE public.network_activity_suggestion_runs
         SET status = 'failed', error_code = COALESCE(p_error_code,'retry_exhausted'),
             lease_owner = NULL, lease_expires_at = NULL, finished_at = now(),
             model_run_id = COALESCE(p_model_run_id, model_run_id),
             model_name = COALESCE(p_model_name, model_name)
       WHERE id = p_run_id;
      RETURN jsonb_build_object('ok', true, 'status', 'failed');
    END IF;
    UPDATE public.network_activity_suggestion_runs
       SET status = 'queued', error_code = p_error_code, lease_owner = NULL,
           lease_expires_at = NULL,
           next_attempt_at = now() + make_interval(secs => 30 * power(3, v_run.attempt_count)::integer),
           model_run_id = COALESCE(p_model_run_id, model_run_id),
           model_name = COALESCE(p_model_name, model_name)
     WHERE id = p_run_id;
    RETURN jsonb_build_object('ok', true, 'status', 'queued');
  END IF;

  IF p_status = 'failed' THEN
    UPDATE public.network_activity_suggestion_runs
       SET status = 'failed', error_code = p_error_code, lease_owner = NULL,
           lease_expires_at = NULL, finished_at = now(),
           model_run_id = COALESCE(p_model_run_id, model_run_id),
           model_name = COALESCE(p_model_name, model_name)
     WHERE id = p_run_id;
    RETURN jsonb_build_object('ok', true, 'status', 'failed');
  END IF;

  IF p_status <> 'succeeded' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_status');
  END IF;

  UPDATE public.network_activity_suggestions s
     SET status = 'superseded', decided_at = now()
   WHERE s.user_id = v_run.user_id
     AND s.status = 'pending_review'
     AND s.run_id <> p_run_id
     AND s.run_id IN (SELECT id FROM public.network_activity_suggestion_runs
                       WHERE user_id = v_run.user_id AND scope_key = v_run.scope_key);

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    INSERT INTO public.network_activity_suggestions
      (run_id, user_id, activity_type, title, rationale, priority,
       suggested_timing, context, evidence)
    VALUES (
      p_run_id, v_run.user_id,
      v_item->>'activityType', v_item->>'title', v_item->>'rationale', v_item->>'priority',
      COALESCE(v_item->'suggestedTiming', '{}'::jsonb),
      COALESCE(v_item->'context', '{}'::jsonb),
      COALESCE(v_item->'evidence', '[]'::jsonb));
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.network_activity_suggestion_runs
     SET status = 'succeeded', error_code = NULL, lease_owner = NULL, lease_expires_at = NULL,
         finished_at = now(), suggestion_count = v_count,
         model_run_id = COALESCE(p_model_run_id, model_run_id),
         model_name = COALESCE(p_model_name, model_name)
   WHERE id = p_run_id;

  RETURN jsonb_build_object('ok', true, 'status', 'succeeded', 'suggestion_count', v_count);
END $$;

CREATE OR REPLACE FUNCTION public.network_reap_stale_suggestion_runs()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_requeued integer; v_failed integer;
BEGIN
  UPDATE public.network_activity_suggestion_runs
     SET status = 'failed', error_code = 'lease_expired', lease_owner = NULL,
         lease_expires_at = NULL, finished_at = now()
   WHERE status = 'running' AND lease_expires_at < now() AND attempt_count >= 3;
  GET DIAGNOSTICS v_failed = ROW_COUNT;

  UPDATE public.network_activity_suggestion_runs
     SET status = 'queued', error_code = 'lease_expired', lease_owner = NULL,
         lease_expires_at = NULL,
         next_attempt_at = now() + make_interval(secs => 30 * power(3, attempt_count)::integer)
   WHERE status = 'running' AND lease_expires_at < now();
  GET DIAGNOSTICS v_requeued = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'requeued', v_requeued, 'failed', v_failed);
END $$;

CREATE OR REPLACE FUNCTION public.network_decide_activity_suggestion(
  p_user_id uuid, p_suggestion_id uuid, p_decision text, p_activity_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  IF p_decision NOT IN ('accepted','dismissed') THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_decision');
  END IF;
  IF p_activity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.next_steps n WHERE n.id = p_activity_id AND n.user_id = p_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_activity');
  END IF;

  UPDATE public.network_activity_suggestions
     SET status = p_decision, decided_at = now(),
         created_activity_id = CASE WHEN p_decision = 'accepted' THEN p_activity_id ELSE NULL END
   WHERE id = p_suggestion_id AND user_id = p_user_id AND status = 'pending_review';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'not_found');
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.network_suggestion_scope_owned(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.network_enqueue_suggestion_run(uuid, text, uuid, text, boolean, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.network_claim_suggestion_run(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.network_heartbeat_suggestion_run(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.network_finish_suggestion_run(uuid, text, text, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.network_reap_stale_suggestion_runs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.network_decide_activity_suggestion(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.network_suggestion_scope_owned(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.network_enqueue_suggestion_run(uuid, text, uuid, text, boolean, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.network_claim_suggestion_run(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.network_heartbeat_suggestion_run(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.network_finish_suggestion_run(uuid, text, text, text, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.network_reap_stale_suggestion_runs() TO service_role;
GRANT EXECUTE ON FUNCTION public.network_decide_activity_suggestion(uuid, uuid, text, uuid) TO service_role;