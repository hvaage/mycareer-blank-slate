ALTER TABLE public.atom_enrichment_proposals
  DROP CONSTRAINT IF EXISTS atom_enrichment_proposals_target_atom_type_check;
ALTER TABLE public.atom_enrichment_proposals
  ADD CONSTRAINT atom_enrichment_proposals_target_atom_type_check
  CHECK (target_atom_type = ANY (ARRAY[
    'career_atom'::text,
    'user_preference_atom'::text,
    'user_evidence_atom'::text,
    'opportunity_requirement_atom'::text,
    'company_profile_atom'::text,
    'company_signal_atom'::text]));

CREATE OR REPLACE FUNCTION public.career_atom_sync_parse_candidate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_raw text;
  v_id uuid;
  v_cand public.cv_parse_candidates%ROWTYPE;
BEGIN
  v_raw := NEW.structured_data ->> 'parse_candidate_id';
  IF v_raw IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_id := v_raw::uuid;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'parse_candidate_id er ikke en gyldig referanse';
  END;

  SELECT * INTO v_cand FROM public.cv_parse_candidates WHERE id = v_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ukjent parsekandidat';
  END IF;
  IF v_cand.user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'Parsekandidaten tilhører en annen bruker';
  END IF;
  IF v_cand.promoted_atom_id IS NOT NULL AND v_cand.promoted_atom_id <> NEW.id THEN
    RAISE EXCEPTION 'Parsekandidaten er allerede bekreftet som et eget element';
  END IF;

  UPDATE public.cv_parse_candidates
     SET status = 'bekreftet',
         resolved_atom_type = COALESCE(resolved_atom_type, NEW.atom_type),
         promoted_atom_id = NEW.id,
         reviewed_at = COALESCE(reviewed_at, pg_catalog.now()),
         updated_at = pg_catalog.now()
   WHERE id = v_id;

  RETURN NEW;
END $function$;

DO $$
DECLARE
  v_user uuid := '8103b452-0a27-46b0-a204-e2d9db34ec22';
  v_import uuid := 'dde8e5d9-b739-4087-b831-f4814a97eaec';
  v_c1 uuid; v_c2 uuid;
  v_res jsonb; v_res2 jsonb;
  v_left int; v_atoms int; v_err text;
  v_atom uuid;
  v_status text; v_type text; v_reviewed timestamptz;
BEGIN
  SELECT id INTO v_c1 FROM public.cv_parse_candidates
   WHERE import_id = v_import AND promoted_atom_id IS NULL ORDER BY id LIMIT 1;
  SELECT id INTO v_c2 FROM public.cv_parse_candidates
   WHERE import_id = v_import AND promoted_atom_id IS NULL AND id <> v_c1 ORDER BY id LIMIT 1;
  SELECT status, resolved_atom_type, reviewed_at INTO v_status, v_type, v_reviewed
    FROM public.cv_parse_candidates WHERE id = v_c1;

  BEGIN
    PERFORM public.internal_ai_create_enrichment_batch(
      v_user,
      jsonb_build_object('source_type','cv_import','source_table','cv_parse_candidates',
        'source_id', v_import::text, 'source_hash','ROLLBACKTEST',
        'input_signature','ROLLBACKTEST','normalizer_version','selftest','title','rollbacktest'),
      jsonb_build_array(
        jsonb_build_object('proposal_action','create_atom','target_atom_type','career_atom',
          'source_type','cv_import','source_table','cv_parse_candidates',
          'source_record_id', v_c1::text, 'source_id', v_import::text,
          'source_import_id', v_import::text, 'source_hash','h1',
          'normalizer_version','selftest','proposal_payload','{}'::jsonb),
        jsonb_build_object('proposal_action','UGYLDIG_ACTION','target_atom_type','career_atom',
          'source_type','cv_import','source_table','cv_parse_candidates',
          'source_record_id', v_c2::text, 'source_id', v_import::text,
          'source_import_id', v_import::text, 'source_hash','h2',
          'normalizer_version','selftest','proposal_payload','{}'::jsonb)));
  EXCEPTION WHEN others THEN
    v_err := SQLERRM;
  END;
  IF v_err IS NULL THEN RAISE EXCEPTION 'SELFTEST: forventet feil i halvferdig sett'; END IF;
  SELECT count(*) INTO v_left FROM public.atom_enrichment_batches WHERE input_signature = 'ROLLBACKTEST';
  IF v_left <> 0 THEN RAISE EXCEPTION 'SELFTEST: rollback feilet, % batch igjen', v_left; END IF;
  RAISE NOTICE 'SELFTEST rollback ok (feil: %)', v_err;

  v_res := public.internal_ai_create_enrichment_batch(
    v_user,
    jsonb_build_object('source_type','cv_import','source_table','cv_parse_candidates',
      'source_id', v_import::text, 'source_hash','SELFTEST_SIG',
      'input_signature','SELFTEST_SIG','normalizer_version','selftest','title','selftest'),
    jsonb_build_array(
      jsonb_build_object('proposal_action','create_atom','target_atom_type','career_atom',
        'source_type','cv_import','source_table','cv_parse_candidates',
        'source_record_id', v_c1::text, 'source_id', v_import::text,
        'source_import_id', v_import::text, 'source_hash','LIK_TEKST',
        'normalizer_version','selftest','proposal_payload', jsonb_build_object('content_no','A')),
      jsonb_build_object('proposal_action','create_atom','target_atom_type','career_atom',
        'source_type','cv_import','source_table','cv_parse_candidates',
        'source_record_id', v_c2::text, 'source_id', v_import::text,
        'source_import_id', v_import::text, 'source_hash','LIK_TEKST',
        'normalizer_version','selftest','proposal_payload', jsonb_build_object('content_no','B')),
      jsonb_build_object('proposal_action','create_atom','target_atom_type','career_atom',
        'source_type','cv_import','source_table','cv_parse_candidates',
        'source_record_id', v_c1::text, 'source_id', v_import::text,
        'source_import_id', v_import::text, 'source_hash','LIK_TEKST',
        'normalizer_version','selftest','proposal_payload', jsonb_build_object('content_no','dublett'))));
  IF (v_res ->> 'inserted')::int <> 2 OR (v_res ->> 'skipped')::int <> 1 THEN
    RAISE EXCEPTION 'SELFTEST: forventet 2 inserted / 1 skipped, fikk %', v_res;
  END IF;

  v_res2 := public.internal_ai_create_enrichment_batch(
    v_user,
    jsonb_build_object('source_type','cv_import','source_table','cv_parse_candidates',
      'source_id', v_import::text, 'source_hash','SELFTEST_SIG',
      'input_signature','SELFTEST_SIG','normalizer_version','selftest','title','selftest'),
    jsonb_build_array(jsonb_build_object('proposal_action','create_atom','target_atom_type','career_atom',
      'source_type','cv_import','source_table','cv_parse_candidates',
      'source_record_id', v_c1::text, 'source_id', v_import::text,
      'source_import_id', v_import::text, 'source_hash','LIK_TEKST',
      'normalizer_version','selftest','proposal_payload','{}'::jsonb)));
  IF (v_res2 ->> 'idempotent')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'SELFTEST: gjentatt kall var ikke idempotent: %', v_res2;
  END IF;
  RAISE NOTICE 'SELFTEST idempotens ok: % / %', v_res, v_res2;

  INSERT INTO public.career_atoms (user_id, atom_kind, atom_type, content_no,
    source_type, source_ref, confidence, structured_data, is_active)
  VALUES (v_user, 'evidens', 'achievement', 'SELFTEST atom', 'cv_import', v_import::text,
    'imported', jsonb_build_object('parse_candidate_id', v_c1::text), true)
  RETURNING id INTO v_atom;

  v_err := NULL;
  BEGIN
    INSERT INTO public.career_atoms (user_id, atom_kind, atom_type, content_no,
      source_type, source_ref, confidence, structured_data, is_active)
    VALUES (v_user, 'evidens', 'achievement', 'SELFTEST atom 2', 'cv_import', v_import::text,
      'imported', jsonb_build_object('parse_candidate_id', v_c1::text), true);
  EXCEPTION WHEN others THEN
    v_err := SQLERRM;
  END;
  IF v_err IS NULL THEN RAISE EXCEPTION 'SELFTEST: dobbel promotering ble tillatt'; END IF;

  SELECT count(*) INTO v_atoms FROM public.career_atoms
   WHERE (structured_data ->> 'parse_candidate_id') = v_c1::text;
  IF v_atoms <> 1 THEN RAISE EXCEPTION 'SELFTEST: forventet 1 atom, fikk %', v_atoms; END IF;
  RAISE NOTICE 'SELFTEST dobbeltvei ok, sperre: %', v_err;

  -- opprydding: tilbakestill kandidaten til opprinnelig tilstand først
  UPDATE public.cv_parse_candidates
     SET status = v_status, resolved_atom_type = v_type,
         promoted_atom_id = NULL, reviewed_at = v_reviewed
   WHERE id = v_c1;
  DELETE FROM public.career_atoms WHERE id = v_atom;
  DELETE FROM public.atom_enrichment_proposals
   WHERE batch_id IN (SELECT id FROM public.atom_enrichment_batches WHERE input_signature = 'SELFTEST_SIG');
  DELETE FROM public.atom_enrichment_batches WHERE input_signature = 'SELFTEST_SIG';
  RAISE NOTICE 'SELFTEST ferdig og ryddet';
END $$;