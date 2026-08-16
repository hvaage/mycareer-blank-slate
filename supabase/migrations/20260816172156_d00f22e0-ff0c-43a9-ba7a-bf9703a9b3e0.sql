CREATE OR REPLACE FUNCTION public.internal_ai_start_model_run(p_correlation_id uuid, p_user_id uuid, p_task_key text, p_model_id text, p_profile_id uuid DEFAULT NULL::uuid, p_profile_snapshot jsonb DEFAULT '{}'::jsonb, p_job_id uuid DEFAULT NULL::uuid, p_api_version text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_id uuid;
BEGIN
  INSERT INTO ai.model_runs
    (correlation_id, user_id, job_id, profile_id, profile_snapshot, task_key, model_id, api_version, status)
  VALUES
    (p_correlation_id, p_user_id, p_job_id, p_profile_id,
     COALESCE(p_profile_snapshot, '{}'::jsonb), p_task_key, p_model_id, p_api_version, 'running')
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.internal_ai_finish_model_run(p_model_run_id uuid, p_status text, p_outcome text DEFAULT NULL::text, p_error_code text DEFAULT NULL::text, p_http_status integer DEFAULT NULL::integer, p_request_id text DEFAULT NULL::text, p_duration_ms integer DEFAULT NULL::integer, p_retry_count integer DEFAULT 0, p_input_tokens integer DEFAULT NULL::integer, p_output_tokens integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE ai.model_runs
     SET status = p_status,
         outcome = p_outcome,
         error_code = p_error_code,
         http_status = p_http_status,
         request_id = p_request_id,
         duration_ms = p_duration_ms,
         retry_count = COALESCE(p_retry_count, 0),
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         finished_at = pg_catalog.now()
   WHERE id = p_model_run_id;
END $function$;

CREATE OR REPLACE FUNCTION public.career_atom_promote_parse_candidate(p_candidate_id uuid, p_atom jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cand public.cv_parse_candidates%ROWTYPE;
  v_atom_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ikke pålogget';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_candidate_id::text, 42));

  SELECT * INTO v_cand
    FROM public.cv_parse_candidates
   WHERE id = p_candidate_id AND user_id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'atom_id', NULL);
  END IF;

  IF v_cand.promoted_atom_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_promoted',
                              'atom_id', v_cand.promoted_atom_id);
  END IF;

  SELECT id INTO v_atom_id
    FROM public.career_atoms
   WHERE (structured_data ->> 'parse_candidate_id') = p_candidate_id::text
   LIMIT 1;

  IF v_atom_id IS NOT NULL THEN
    UPDATE public.cv_parse_candidates
       SET status = 'bekreftet',
           resolved_atom_type = COALESCE(resolved_atom_type, suggested_atom_type),
           promoted_atom_id = v_atom_id,
           reviewed_at = COALESCE(reviewed_at, pg_catalog.now()),
           updated_at = pg_catalog.now()
     WHERE id = p_candidate_id;
    RETURN jsonb_build_object('status', 'already_promoted', 'atom_id', v_atom_id);
  END IF;

  INSERT INTO public.career_atoms (
    user_id, atom_kind, atom_type, content_no, source_type, source_ref,
    source_quote, confidence, parent_atom_id, structured_data, is_active
  ) VALUES (
    v_uid,
    COALESCE(p_atom ->> 'atom_kind', 'evidens'),
    p_atom ->> 'atom_type',
    p_atom ->> 'content_no',
    COALESCE(p_atom ->> 'source_type', 'cv_import'),
    p_atom ->> 'source_ref',
    p_atom ->> 'source_quote',
    COALESCE(p_atom ->> 'confidence', 'imported'),
    NULLIF(p_atom ->> 'parent_atom_id','')::uuid,
    pg_catalog.jsonb_set(
      COALESCE(p_atom -> 'structured_data', '{}'::jsonb),
      '{parse_candidate_id}', pg_catalog.to_jsonb(p_candidate_id::text), true),
    true
  )
  RETURNING id INTO v_atom_id;

  RETURN jsonb_build_object('status', 'promoted', 'atom_id', v_atom_id);
END;
$function$;