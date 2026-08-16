ALTER TABLE public.atom_enrichment_proposals
  ADD COLUMN IF NOT EXISTS source_import_id uuid,
  ADD COLUMN IF NOT EXISTS normalizer_version text,
  ADD COLUMN IF NOT EXISTS prompt_version text,
  ADD COLUMN IF NOT EXISTS model_run_id uuid;

DROP INDEX IF EXISTS public.atom_enrichment_proposals_parse_candidate_unique;

CREATE UNIQUE INDEX IF NOT EXISTS atom_enrichment_proposals_cv_idem_unique
  ON public.atom_enrichment_proposals
  (user_id, source_import_id, source_record_id, source_hash, normalizer_version)
  WHERE source_table = 'cv_parse_candidates'
    AND status = ANY (ARRAY['pending_review'::public.atom_enrichment_proposal_status,
                            'approved'::public.atom_enrichment_proposal_status]);

ALTER TABLE public.atom_enrichment_batches
  ADD COLUMN IF NOT EXISTS input_signature text,
  ADD COLUMN IF NOT EXISTS normalizer_version text,
  ADD COLUMN IF NOT EXISTS model_run_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS atom_enrichment_batches_input_signature_unique
  ON public.atom_enrichment_batches (user_id, source_table, source_id, input_signature)
  WHERE input_signature IS NOT NULL;

CREATE OR REPLACE FUNCTION public.internal_ai_create_enrichment_batch(
  p_user_id uuid,
  p_batch jsonb,
  p_proposals jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_batch_id uuid;
  v_existing uuid;
  v_signature text;
  v_inserted int := 0;
  v_skipped int := 0;
  v_item jsonb;
  v_new_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_batch IS NULL THEN
    RAISE EXCEPTION 'manglende input';
  END IF;
  IF p_proposals IS NULL OR jsonb_typeof(p_proposals) <> 'array'
     OR jsonb_array_length(p_proposals) = 0 THEN
    RAISE EXCEPTION 'tomt forslagssett';
  END IF;

  v_signature := p_batch ->> 'input_signature';

  SELECT id INTO v_existing
    FROM public.atom_enrichment_batches
   WHERE user_id = p_user_id
     AND source_table = (p_batch ->> 'source_table')
     AND source_id = (p_batch ->> 'source_id')
     AND input_signature IS NOT DISTINCT FROM v_signature
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'batch_id', v_existing,
      'idempotent', true,
      'inserted', 0,
      'skipped', jsonb_array_length(p_proposals)
    );
  END IF;

  INSERT INTO public.atom_enrichment_batches (
    user_id, source_type, source_table, source_id, source_record_id,
    source_hash, input_signature, normalizer_version, model_run_id,
    title, status, context
  ) VALUES (
    p_user_id,
    p_batch ->> 'source_type',
    p_batch ->> 'source_table',
    p_batch ->> 'source_id',
    NULLIF(p_batch ->> 'source_record_id','')::uuid,
    p_batch ->> 'source_hash',
    v_signature,
    p_batch ->> 'normalizer_version',
    NULLIF(p_batch ->> 'model_run_id','')::uuid,
    p_batch ->> 'title',
    COALESCE((p_batch ->> 'status')::public.atom_enrichment_batch_status, 'open'),
    COALESCE(p_batch -> 'context', '{}'::jsonb)
  )
  RETURNING id INTO v_batch_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_proposals)
  LOOP
    INSERT INTO public.atom_enrichment_proposals (
      batch_id, user_id, proposal_action, target_atom_type,
      source_type, source_table, source_record_id, source_id,
      source_import_id, source_hash, normalizer_version, prompt_version,
      model_run_id, confidence, inferred, rationale, explanation,
      status, proposal_payload
    ) VALUES (
      v_batch_id,
      p_user_id,
      (v_item ->> 'proposal_action')::public.atom_enrichment_proposal_action,
      v_item ->> 'target_atom_type',
      v_item ->> 'source_type',
      v_item ->> 'source_table',
      NULLIF(v_item ->> 'source_record_id','')::uuid,
      v_item ->> 'source_id',
      NULLIF(v_item ->> 'source_import_id','')::uuid,
      v_item ->> 'source_hash',
      v_item ->> 'normalizer_version',
      v_item ->> 'prompt_version',
      NULLIF(v_item ->> 'model_run_id','')::uuid,
      (v_item ->> 'confidence')::numeric,
      COALESCE((v_item ->> 'inferred')::boolean, true),
      v_item ->> 'rationale',
      v_item ->> 'explanation',
      'pending_review'::public.atom_enrichment_proposal_status,
      COALESCE(v_item -> 'proposal_payload', '{}'::jsonb)
    )
    ON CONFLICT (user_id, source_import_id, source_record_id, source_hash, normalizer_version)
      WHERE source_table = 'cv_parse_candidates'
        AND status = ANY (ARRAY['pending_review'::public.atom_enrichment_proposal_status,
                                'approved'::public.atom_enrichment_proposal_status])
      DO NOTHING
    RETURNING id INTO v_new_id;

    IF v_new_id IS NULL THEN
      v_skipped := v_skipped + 1;
    ELSE
      v_inserted := v_inserted + 1;
    END IF;
    v_new_id := NULL;
  END LOOP;

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'idempotent', false,
    'inserted', v_inserted,
    'skipped', v_skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.internal_ai_create_enrichment_batch(uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_ai_create_enrichment_batch(uuid, jsonb, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.internal_ai_create_enrichment_batch(uuid, jsonb, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.internal_ai_create_enrichment_batch(uuid, jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.internal_ai_check_run_limits(
  p_user_id uuid,
  p_task_key text,
  p_import_id text,
  p_max_active_per_user int DEFAULT 2,
  p_max_active_per_import int DEFAULT 1,
  p_max_per_hour int DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_active_user int;
  v_active_import int;
  v_last_hour int;
BEGIN
  SELECT count(*) INTO v_active_user
    FROM ai.model_runs
   WHERE user_id = p_user_id
     AND task_key = p_task_key
     AND status = 'running'
     AND started_at > pg_catalog.now() - interval '10 minutes';

  SELECT count(*) INTO v_active_import
    FROM ai.model_runs
   WHERE user_id = p_user_id
     AND task_key = p_task_key
     AND status = 'running'
     AND started_at > pg_catalog.now() - interval '10 minutes'
     AND profile_snapshot ->> 'cv_import_id' = p_import_id;

  SELECT count(*) INTO v_last_hour
    FROM ai.model_runs
   WHERE user_id = p_user_id
     AND task_key = p_task_key
     AND started_at > pg_catalog.now() - interval '1 hour';

  IF v_active_import >= p_max_active_per_import THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'import_run_in_progress',
                              'active_import', v_active_import);
  END IF;
  IF v_active_user >= p_max_active_per_user THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'too_many_active_runs',
                              'active_user', v_active_user);
  END IF;
  IF v_last_hour >= p_max_per_hour THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'rate_limited',
                              'runs_last_hour', v_last_hour);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'active_user', v_active_user,
                            'active_import', v_active_import,
                            'runs_last_hour', v_last_hour);
END;
$$;

REVOKE ALL ON FUNCTION public.internal_ai_check_run_limits(uuid, text, text, int, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.internal_ai_check_run_limits(uuid, text, text, int, int, int) FROM anon;
REVOKE ALL ON FUNCTION public.internal_ai_check_run_limits(uuid, text, text, int, int, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.internal_ai_check_run_limits(uuid, text, text, int, int, int) TO service_role;

CREATE OR REPLACE FUNCTION public.career_atom_promote_parse_candidate(
  p_candidate_id uuid,
  p_atom jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
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
           promoted_atom_id = v_atom_id,
           reviewed_at = pg_catalog.coalesce(reviewed_at, pg_catalog.now()),
           updated_at = pg_catalog.now()
     WHERE id = p_candidate_id;
    RETURN jsonb_build_object('status', 'already_promoted', 'atom_id', v_atom_id);
  END IF;

  INSERT INTO public.career_atoms (
    user_id, atom_kind, atom_type, content_no, source_type, source_ref,
    source_quote, confidence, parent_atom_id, structured_data, is_active
  ) VALUES (
    v_uid,
    pg_catalog.coalesce(p_atom ->> 'atom_kind', 'evidens'),
    p_atom ->> 'atom_type',
    p_atom ->> 'content_no',
    pg_catalog.coalesce(p_atom ->> 'source_type', 'cv_import'),
    p_atom ->> 'source_ref',
    p_atom ->> 'source_quote',
    pg_catalog.coalesce(p_atom ->> 'confidence', 'imported'),
    NULLIF(p_atom ->> 'parent_atom_id','')::uuid,
    pg_catalog.jsonb_set(
      pg_catalog.coalesce(p_atom -> 'structured_data', '{}'::jsonb),
      '{parse_candidate_id}', pg_catalog.to_jsonb(p_candidate_id::text), true),
    true
  )
  RETURNING id INTO v_atom_id;

  RETURN jsonb_build_object('status', 'promoted', 'atom_id', v_atom_id);
END;
$$;

REVOKE ALL ON FUNCTION public.career_atom_promote_parse_candidate(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.career_atom_promote_parse_candidate(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.career_atom_promote_parse_candidate(uuid, jsonb) TO authenticated, service_role;