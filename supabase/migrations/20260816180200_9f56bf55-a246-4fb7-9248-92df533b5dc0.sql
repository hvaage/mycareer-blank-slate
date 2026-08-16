-- 1. jobbtilstand -----------------------------------------------------------
ALTER TABLE public.cv_generation_jobs
  ADD COLUMN IF NOT EXISTS current_step text,
  ADD COLUMN IF NOT EXISTS rewrite_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS step_state jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. blokker og claims -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cv_document_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  block_id text NOT NULL,
  section text NOT NULL,
  ordinal integer NOT NULL DEFAULT 0,
  text text NOT NULL,
  supporting_atom_ids uuid[] NOT NULL DEFAULT '{}',
  requirement_atom_ids uuid[] NOT NULL DEFAULT '{}',
  claim_ids text[] NOT NULL DEFAULT '{}',
  source_snapshot_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, block_id)
);

CREATE TABLE IF NOT EXISTS public.cv_document_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  claim_id text NOT NULL,
  block_id text NOT NULL,
  claim_type text NOT NULL CHECK (claim_type IN ('hard','soft')),
  value text NOT NULL,
  supporting_atom_ids uuid[] NOT NULL DEFAULT '{}',
  verification text NOT NULL DEFAULT 'unsupported'
    CHECK (verification IN ('supported','partially_supported','unsupported','not_applicable')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, claim_id)
);

CREATE INDEX IF NOT EXISTS cv_document_blocks_doc_idx ON public.cv_document_blocks(document_id);
CREATE INDEX IF NOT EXISTS cv_document_claims_doc_idx ON public.cv_document_claims(document_id);

GRANT SELECT ON public.cv_document_blocks TO authenticated;
GRANT SELECT ON public.cv_document_claims TO authenticated;
GRANT ALL ON public.cv_document_blocks TO service_role;
GRANT ALL ON public.cv_document_claims TO service_role;

ALTER TABLE public.cv_document_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cv_document_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own cv blocks" ON public.cv_document_blocks;
CREATE POLICY "Users can view own cv blocks" ON public.cv_document_blocks
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own cv claims" ON public.cv_document_claims;
CREATE POLICY "Users can view own cv claims" ON public.cv_document_claims
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 3. modellprofiler ----------------------------------------------------------
INSERT INTO ai.model_profiles
  (profile_key, task_key, model_id, prompt_version, max_tokens, request_options, capabilities, cost_tier, is_active)
VALUES
  ('cv_general_generation_v1','cv_general_generation','claude-sonnet-5','1.0.0',16000,'{}'::jsonb,
   '{"supportsTemperature":false,"supportsTopP":false,"supportsTopK":false,"supportsThinking":false,"supportsPrefill":false}'::jsonb,'standard',true),
  ('cv_quality_rewrite_v1','cv_quality_rewrite','claude-sonnet-4-6','1.0.0',8000,'{}'::jsonb,
   '{"supportsTemperature":false,"supportsTopP":false,"supportsTopK":false,"supportsThinking":false,"supportsPrefill":false}'::jsonb,'standard',true),
  ('cv_soft_claim_judge_v1','cv_soft_claim_judge','claude-haiku-4-5-20251001','1.0.0',1500,'{}'::jsonb,
   '{"supportsTemperature":false,"supportsTopP":false,"supportsTopK":false,"supportsThinking":false,"supportsPrefill":false}'::jsonb,'cheap',true)
ON CONFLICT (profile_key) DO UPDATE
  SET model_id = EXCLUDED.model_id, max_tokens = EXCLUDED.max_tokens,
      capabilities = EXCLUDED.capabilities, is_active = true, updated_at = now();

-- 4. opprett generering atomisk ---------------------------------------------
CREATE OR REPLACE FUNCTION public.internal_ai_create_cv_generation(
  p_user_id uuid,
  p_title text,
  p_presentation jsonb,
  p_atom_ids uuid[],
  p_snapshot jsonb,
  p_snapshot_hash text,
  p_readiness jsonb,
  p_profile_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_group uuid := gen_random_uuid(); v_doc uuid; v_job jsonb;
BEGIN
  INSERT INTO public.documents
    (user_id, title, document_type, document_group_id, version, cv_variant,
     is_base_version, atom_ids, atom_snapshot, render_language, content_text)
  VALUES
    (p_user_id, p_title, 'cv', v_group, 1, 'general', true,
     p_atom_ids, p_snapshot, COALESCE(p_presentation->>'language','no'), NULL)
  RETURNING id INTO v_doc;

  v_job := public.internal_ai_enqueue_job(
    p_user_id, v_group, 'generate_general_cv',
    jsonb_build_object(
      'variant','general',
      'presentation', COALESCE(p_presentation,'{}'::jsonb),
      'document_id', v_doc,
      'snapshot_hash', p_snapshot_hash,
      'readiness', COALESCE(p_readiness,'{}'::jsonb)
    ),
    p_profile_id, NULL, 100::smallint, 120000, 5, 20
  );

  IF COALESCE((v_job->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'enqueue_failed:%', COALESCE(v_job->>'error_code','unknown')
      USING ERRCODE = 'raise_exception';
  END IF;

  UPDATE public.cv_generation_jobs
     SET current_step = 'prepare_snapshot', document_id = v_doc
   WHERE id = (v_job->>'job_id')::uuid;

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', v_job->>'job_id',
    'document_group_id', v_group,
    'document_version_id', v_doc,
    'status', 'queued',
    'step', 'prepare_snapshot'
  );
EXCEPTION WHEN raise_exception THEN
  RETURN jsonb_build_object('ok', false, 'error_code',
    split_part(SQLERRM, ':', 2));
END $$;

REVOKE ALL ON FUNCTION public.internal_ai_create_cv_generation(uuid,text,jsonb,uuid[],jsonb,text,jsonb,uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_ai_create_cv_generation(uuid,text,jsonb,uuid[],jsonb,text,jsonb,uuid) TO service_role;

-- 5. commit av ett steg, atomisk og idempotent -------------------------------
CREATE OR REPLACE FUNCTION public.internal_ai_generation_commit_step(
  p_job_id uuid,
  p_worker_id text,
  p_step text,
  p_next_step text,
  p_new_version boolean,
  p_content_text text,
  p_blocks jsonb,
  p_claims jsonb,
  p_output_hash text,
  p_quality jsonb,
  p_guard jsonb,
  p_ats jsonb,
  p_model_run_id uuid,
  p_terminal text,
  p_error_code text,
  p_state_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_job public.cv_generation_jobs%ROWTYPE;
  v_doc uuid; v_group uuid; v_version integer; v_user uuid;
BEGIN
  SELECT * INTO v_job FROM public.cv_generation_jobs
   WHERE id = p_job_id FOR UPDATE;

  IF v_job.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'not_found');
  END IF;
  IF v_job.status <> 'running' OR v_job.locked_by IS DISTINCT FROM p_worker_id THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'lease_lost');
  END IF;
  -- idempotens: steget er allerede utført, ingen nye rader eller versjoner
  IF v_job.current_step IS DISTINCT FROM p_step THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true,
      'step', v_job.current_step, 'document_id', v_job.document_id);
  END IF;

  v_user := v_job.user_id;
  v_doc := v_job.document_id;

  IF p_content_text IS NOT NULL OR p_blocks IS NOT NULL THEN
    IF p_new_version IS TRUE THEN
      SELECT document_group_id, COALESCE(max(version),1) INTO v_group, v_version
        FROM public.documents
       WHERE document_group_id = v_job.document_group_id
       GROUP BY document_group_id;

      INSERT INTO public.documents
        (user_id, title, document_type, document_group_id, version, cv_variant,
         is_base_version, atom_ids, atom_snapshot, render_language, content_text)
      SELECT d.user_id, d.title, d.document_type, d.document_group_id, v_version + 1,
             d.cv_variant, false, d.atom_ids, d.atom_snapshot, d.render_language,
             COALESCE(p_content_text, d.content_text)
        FROM public.documents d WHERE d.id = v_doc
      RETURNING id INTO v_doc;
    ELSIF p_content_text IS NOT NULL THEN
      UPDATE public.documents SET content_text = p_content_text, updated_at = now()
       WHERE id = v_doc;
    END IF;

    IF p_blocks IS NOT NULL THEN
      DELETE FROM public.cv_document_blocks WHERE document_id = v_doc;
      INSERT INTO public.cv_document_blocks
        (document_id, user_id, block_id, section, ordinal, text,
         supporting_atom_ids, requirement_atom_ids, claim_ids, source_snapshot_hash)
      SELECT v_doc, v_user, b->>'blockId', b->>'section',
             COALESCE((b->>'ordinal')::int, 0), b->>'text',
             COALESCE((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(b->'supportingAtomIds') x), '{}'),
             COALESCE((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(b->'requirementAtomIds') x), '{}'),
             COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(b->'claimIds') x), '{}'),
             b->>'sourceSnapshotHash'
        FROM jsonb_array_elements(p_blocks) b;
    END IF;

    IF p_claims IS NOT NULL THEN
      DELETE FROM public.cv_document_claims WHERE document_id = v_doc;
      INSERT INTO public.cv_document_claims
        (document_id, user_id, claim_id, block_id, claim_type, value,
         supporting_atom_ids, verification)
      SELECT v_doc, v_user, c->>'claimId', c->>'blockId', c->>'type', c->>'value',
             COALESCE((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(c->'supportingAtomIds') x), '{}'),
             COALESCE(c->>'verification','unsupported')
        FROM jsonb_array_elements(p_claims) c;
    END IF;
  END IF;

  UPDATE public.documents
     SET quality_result = COALESCE(p_quality, quality_result),
         guard_result   = COALESCE(p_guard, guard_result),
         ats_rules_version = COALESCE(p_ats->>'rules_version', ats_rules_version),
         guard_version  = COALESCE(p_guard->>'guard_version', guard_version),
         updated_at = now()
   WHERE id = v_doc;

  UPDATE public.cv_generation_jobs j
     SET document_id = v_doc,
         current_step = CASE WHEN p_terminal IS NULL THEN p_next_step ELSE p_step END,
         rewrite_count = j.rewrite_count + CASE WHEN p_step = 'quality_rewrite' THEN 1 ELSE 0 END,
         step_state = j.step_state
                      || COALESCE(p_state_patch, '{}'::jsonb)
                      || jsonb_build_object('output_hash', p_output_hash,
                                            'last_step', p_step,
                                            'ats', COALESCE(p_ats, j.step_state->'ats')),
         model_run_id = COALESCE(p_model_run_id, j.model_run_id),
         status = CASE
                    WHEN p_terminal = 'waiting_review' THEN 'waiting_review'
                    WHEN p_terminal = 'failed' THEN 'failed'
                    ELSE 'queued' END,
         locked_by = NULL, locked_at = NULL, lease_expires_at = NULL,
         run_after = now(),
         error_code = p_error_code,
         last_error = p_error_code,
         finished_at = CASE WHEN p_terminal = 'failed' THEN now() ELSE NULL END,
         updated_at = now()
   WHERE j.id = p_job_id;

  RETURN jsonb_build_object('ok', true, 'document_id', v_doc,
    'step', CASE WHEN p_terminal IS NULL THEN p_next_step ELSE p_step END,
    'terminal', p_terminal);
END $$;

REVOKE ALL ON FUNCTION public.internal_ai_generation_commit_step(uuid,text,text,text,boolean,text,jsonb,jsonb,text,jsonb,jsonb,jsonb,uuid,text,text,jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_ai_generation_commit_step(uuid,text,text,text,boolean,text,jsonb,jsonb,text,jsonb,jsonb,jsonb,uuid,text,text,jsonb) TO service_role;

-- 6. sanitert status for eier ------------------------------------------------
CREATE OR REPLACE FUNCTION public.internal_ai_get_cv_generation(p_user_id uuid, p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v jsonb; v_job public.cv_generation_jobs%ROWTYPE; v_doc public.documents%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.cv_generation_jobs
   WHERE id = p_job_id AND user_id = p_user_id;
  IF v_job.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'not_found');
  END IF;

  SELECT * INTO v_doc FROM public.documents WHERE id = v_job.document_id;

  v := jsonb_build_object(
    'jobId', v_job.id,
    'status', v_job.status,
    'step', v_job.current_step,
    'attemptCount', v_job.attempt_count,
    'maxAttempts', v_job.max_attempts,
    'updatedAt', v_job.updated_at,
    'errorCode', v_job.error_code,
    'documentGroupId', v_job.document_group_id,
    'documentVersionId', v_job.document_id,
    'readiness', v_job.input_payload->'readiness',
    'document', CASE WHEN v_doc.id IS NULL THEN NULL ELSE jsonb_build_object(
        'documentVersionId', v_doc.id,
        'version', v_doc.version,
        'title', v_doc.title,
        'language', v_doc.render_language,
        'outputHash', v_job.step_state->>'output_hash',
        'snapshotHash', v_job.input_payload->>'snapshot_hash',
        'contentText', v_doc.content_text,
        'quality', v_doc.quality_result,
        'guard', v_doc.guard_result,
        'ats', v_job.step_state->'ats',
        'blocks', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'blockId', b.block_id, 'section', b.section, 'text', b.text,
            'supportingAtomIds', to_jsonb(b.supporting_atom_ids),
            'requirementAtomIds', to_jsonb(b.requirement_atom_ids),
            'claimIds', to_jsonb(b.claim_ids),
            'sourceSnapshotHash', b.source_snapshot_hash) ORDER BY b.ordinal)
          FROM public.cv_document_blocks b WHERE b.document_id = v_doc.id), '[]'::jsonb),
        'claims', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'claimId', c.claim_id, 'blockId', c.block_id, 'type', c.claim_type,
            'value', c.value, 'supportingAtomIds', to_jsonb(c.supporting_atom_ids),
            'verification', c.verification))
          FROM public.cv_document_claims c WHERE c.document_id = v_doc.id), '[]'::jsonb)
      ) END
  );
  RETURN jsonb_build_object('ok', true, 'generation', v);
END $$;

REVOKE ALL ON FUNCTION public.internal_ai_get_cv_generation(uuid,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.internal_ai_get_cv_generation(uuid,uuid) TO authenticated, service_role;