-- 1) Utvidet idempotensnøkkel: prompt_version inngår, og avviste/avklaringsforslag
--    blokkerer automatisk gjenoppretting.
DROP INDEX IF EXISTS public.atom_enrichment_proposals_cv_idem_unique;

CREATE UNIQUE INDEX atom_enrichment_proposals_cv_idem_unique
  ON public.atom_enrichment_proposals
       (user_id, source_import_id, source_record_id, source_hash,
        normalizer_version, prompt_version)
 WHERE source_table = 'cv_parse_candidates'
   AND status = ANY (ARRAY[
         'pending_review'::public.atom_enrichment_proposal_status,
         'approved'::public.atom_enrichment_proposal_status,
         'rejected'::public.atom_enrichment_proposal_status,
         'needs_more_context'::public.atom_enrichment_proposal_status]);

-- 2) Innsettingsfunksjonen må treffe den nye indeksen.
CREATE OR REPLACE FUNCTION public.internal_ai_create_enrichment_batch(
  p_user_id uuid, p_batch jsonb, p_proposals jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
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
    ON CONFLICT (user_id, source_import_id, source_record_id, source_hash,
                 normalizer_version, prompt_version)
      WHERE source_table = 'cv_parse_candidates'
        AND status = ANY (ARRAY['pending_review'::public.atom_enrichment_proposal_status,
                                'approved'::public.atom_enrichment_proposal_status,
                                'rejected'::public.atom_enrichment_proposal_status,
                                'needs_more_context'::public.atom_enrichment_proposal_status])
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
$function$;

-- 3) Eksplisitt regenerering bestilt av brukeren.
CREATE OR REPLACE FUNCTION public.internal_ai_begin_regeneration(
  p_user_id uuid, p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_superseded int := 0;
  v_epoch int := 0;
BEGIN
  IF p_user_id IS NULL OR p_import_id IS NULL THEN
    RAISE EXCEPTION 'manglende input';
  END IF;

  UPDATE public.atom_enrichment_proposals
     SET status = 'superseded'::public.atom_enrichment_proposal_status,
         updated_at = now()
   WHERE user_id = p_user_id
     AND source_table = 'cv_parse_candidates'
     AND source_import_id = p_import_id
     AND status IN ('rejected'::public.atom_enrichment_proposal_status,
                    'needs_more_context'::public.atom_enrichment_proposal_status);
  GET DIAGNOSTICS v_superseded = ROW_COUNT;

  SELECT count(*)::int INTO v_epoch
    FROM public.atom_enrichment_batches
   WHERE user_id = p_user_id
     AND source_table = 'cv_parse_candidates'
     AND source_id = p_import_id::text;

  RETURN jsonb_build_object('epoch', v_epoch, 'superseded', v_superseded);
END;
$function$;

REVOKE ALL ON FUNCTION public.internal_ai_begin_regeneration(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_ai_begin_regeneration(uuid, uuid) TO service_role;