-- Kanonisk variantmapping: API/kontrakt bruker general/tailored,
-- databasen bruker generell/tilpasset. Én funksjon eier oversettelsen.
CREATE OR REPLACE FUNCTION public.cv_variant_db(p_variant text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(coalesce(p_variant,''))
    WHEN 'general'  THEN 'generell'
    WHEN 'generell' THEN 'generell'
    WHEN 'tailored' THEN 'tilpasset'
    WHEN 'tilpasset' THEN 'tilpasset'
    ELSE NULL
  END
$$;

REVOKE ALL ON FUNCTION public.cv_variant_db(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cv_variant_db(text) TO authenticated, service_role;

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
DECLARE
  v_doc uuid := gen_random_uuid();
  v_job jsonb;
  v_variant_api text := 'general';
  v_variant_db text := public.cv_variant_db('general');
BEGIN
  IF v_variant_db IS NULL THEN
    RAISE EXCEPTION 'unknown_variant:%', v_variant_api USING ERRCODE = 'raise_exception';
  END IF;

  -- Rotdokumentet er sin egen gruppe: document_group_id refererer documents(id).
  INSERT INTO public.documents
    (id, user_id, title, document_type, document_group_id, version, cv_variant,
     is_base_version, atom_ids, atom_snapshot, render_language, content_text)
  VALUES
    (v_doc, p_user_id, p_title, 'cv', v_doc, 1, v_variant_db, true,
     p_atom_ids, p_snapshot, COALESCE(p_presentation->>'language','no'), NULL);

  v_job := public.internal_ai_enqueue_job(
    p_user_id, v_doc, 'generate_general_cv',
    jsonb_build_object(
      'variant', v_variant_api,
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
    'document_group_id', v_doc,
    'document_version_id', v_doc,
    'status', 'queued',
    'step', 'prepare_snapshot'
  );
EXCEPTION WHEN raise_exception THEN
  RETURN jsonb_build_object('ok', false, 'error_code', split_part(SQLERRM, ':', 2));
END $$;

REVOKE ALL ON FUNCTION public.internal_ai_create_cv_generation(uuid,text,jsonb,uuid[],jsonb,text,jsonb,uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_ai_create_cv_generation(uuid,text,jsonb,uuid[],jsonb,text,jsonb,uuid) TO service_role;