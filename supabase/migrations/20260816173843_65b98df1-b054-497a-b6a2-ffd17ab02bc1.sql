DO $$
DECLARE
  u1 uuid := '3b5e8b1c-e3bb-43d2-a96f-0b40cf21b874';
  u2 uuid := '8103b452-0a27-46b0-a204-e2d9db34ec22';
  imp uuid := '00000000-0000-4000-8000-0000feed0001';
  rec uuid := '00000000-0000-4000-8000-0000feed0002';
  batch jsonb; props jsonb; r jsonb; regen jsonb;
  n int; epoch1 int; epoch2 int; cnt int;
BEGIN
  batch := jsonb_build_object(
    'source_type','cv_import','source_table','cv_parse_candidates',
    'source_id', imp::text,'source_hash','h-selftest',
    'input_signature','sig-A','normalizer_version','nv1','title','selftest');
  props := jsonb_build_array(jsonb_build_object(
    'proposal_action','create_atom','target_atom_type','career_atom',
    'source_type','cv_import','source_table','cv_parse_candidates',
    'source_record_id', rec::text,'source_id', imp::text,'source_import_id', imp::text,
    'source_hash','h-selftest','normalizer_version','nv1','prompt_version','pv1',
    'confidence',0.8,'inferred',true,'rationale','selftest',
    'proposal_payload', jsonb_build_object('content_no','Selvtest')));

  -- A) første kjøring lager forslaget
  r := public.internal_ai_create_enrichment_batch(u1, batch, props);
  IF (r->>'inserted')::int <> 1 THEN RAISE EXCEPTION 'A: forventet 1 innsatt, fikk %', r; END IF;

  -- B) samme signatur -> idempotent, ingen nye rader
  r := public.internal_ai_create_enrichment_batch(u1, batch, props);
  IF (r->>'idempotent')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'B: ikke idempotent: %', r; END IF;

  -- C) bruker avviser forslaget
  UPDATE public.atom_enrichment_proposals SET status='rejected'
   WHERE user_id=u1 AND source_import_id=imp;

  -- D) retry med ny batch-signatur men samme forslagsnøkkel -> ingen gjenoppstandelse
  r := public.internal_ai_create_enrichment_batch(
         u1, batch || jsonb_build_object('input_signature','sig-B'), props);
  IF (r->>'inserted')::int <> 0 OR (r->>'skipped')::int <> 1 THEN
    RAISE EXCEPTION 'D: avvist forslag gjenoppsto: %', r; END IF;
  SELECT count(*) INTO n FROM public.atom_enrichment_proposals
   WHERE user_id=u1 AND source_import_id=imp AND status='pending_review';
  IF n <> 0 THEN RAISE EXCEPTION 'D2: % ventende forslag etter avvisning', n; END IF;

  -- E) eksplisitt regenerering: avvist blir superseded og epoken øker
  SELECT count(*)::int INTO epoch1 FROM public.atom_enrichment_batches
   WHERE user_id=u1 AND source_table='cv_parse_candidates' AND source_id=imp::text;
  regen := public.internal_ai_begin_regeneration(u1, imp);
  IF (regen->>'superseded')::int <> 1 THEN RAISE EXCEPTION 'E: ingenting erstattet: %', regen; END IF;
  epoch2 := (regen->>'epoch')::int;
  IF epoch2 <> epoch1 THEN RAISE EXCEPTION 'E2: epoke % vs %', epoch2, epoch1; END IF;
  r := public.internal_ai_create_enrichment_batch(
         u1, batch || jsonb_build_object('input_signature','sig-C'), props);
  IF (r->>'inserted')::int <> 1 THEN RAISE EXCEPTION 'E3: regenerering ga ingen nye forslag: %', r; END IF;
  IF (public.internal_ai_begin_regeneration(u1, imp)->>'epoch')::int <= epoch2 THEN
    RAISE EXCEPTION 'E4: epoken økte ikke etter ny batch'; END IF;

  -- F) tilgang på tvers av brukere
  PERFORM set_config('role','authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u2::text, 'role','authenticated')::text, true);
  SELECT count(*) INTO cnt FROM public.atom_enrichment_proposals WHERE source_import_id = imp;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims','', true);
  IF cnt <> 0 THEN RAISE EXCEPTION 'F: annen bruker så % forslag', cnt; END IF;

  -- opprydding
  DELETE FROM public.atom_enrichment_proposals WHERE user_id=u1 AND source_import_id=imp;
  DELETE FROM public.atom_enrichment_batches WHERE user_id=u1 AND source_id=imp::text;
  RAISE NOTICE 'selvtest OK';
END $$;