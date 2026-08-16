CREATE OR REPLACE FUNCTION public.internal_ai_generation_commit_step(
  p_job_id uuid,
  p_worker_id text,
  p_step text,
  p_next_step text,
  p_content_text text,
  p_blocks jsonb,
  p_claims jsonb,
  p_quality jsonb,
  p_guard jsonb,
  p_ats jsonb,
  p_output_hash text,
  p_state_patch jsonb,
  p_model_run_id uuid,
  p_terminal text,
  p_error_code text,
  p_new_version boolean
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
  END IF;

  -- Claims skrives uavhengig av om teksten endres: verifikasjonsstatus fra
  -- guard-steget må kunne oppdateres uten ny dokumentversjon.
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