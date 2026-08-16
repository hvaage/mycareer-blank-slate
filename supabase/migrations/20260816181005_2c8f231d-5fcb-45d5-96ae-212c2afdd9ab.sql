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
    (p_user_id, p_title, 'cv', v_group, 1, 'generell', true,
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
  RETURN jsonb_build_object('ok', false, 'error_code', split_part(SQLERRM, ':', 2));
END $$;

REVOKE ALL ON FUNCTION public.internal_ai_create_cv_generation(uuid,text,jsonb,uuid[],jsonb,text,jsonb,uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_ai_create_cv_generation(uuid,text,jsonb,uuid[],jsonb,text,jsonb,uuid) TO service_role;

-- Rydd testdokumentet fra feilsøkingen (ingen jobb ble opprettet for det).
DELETE FROM public.documents WHERE title = 'Testkall' AND document_type = 'cv';