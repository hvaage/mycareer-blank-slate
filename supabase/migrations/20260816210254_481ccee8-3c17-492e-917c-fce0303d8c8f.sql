DO $$
DECLARE
  v_user uuid := '8103b452-0a27-46b0-a204-e2d9db34ec22';
  v_import uuid := '099e4315-8387-4ffd-a22d-89f9f1e5bb1c';
  v_role uuid;
  v_res jsonb;
  v_atom uuid;
  v_link uuid;
  v_parent uuid;
  v_status text;
  v_src text;
  v_cnt int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role','authenticated')::text, true);

  INSERT INTO public.career_atoms (user_id, atom_kind, atom_type, content_no, structured_data,
    source_type, source_ref, confidence, user_confirmed, refreshed_at, last_seen_at)
  VALUES (v_user,'evidens','role','SELFTEST rolle',
    jsonb_build_object('employer','SELFTEST AS','start_date','2020-01-01','end_date','2021-01-01'),
    'user_input','selftest','verified',true,now(),now())
  RETURNING id INTO v_role;

  v_res := public.career_atom_add_manual_result('SELFTEST resultat', v_role, v_import);
  v_atom := (v_res->>'atom_id')::uuid;
  v_link := (v_res->>'link_id')::uuid;

  SELECT status INTO v_status FROM public.career_atom_links WHERE id = v_link;
  IF v_status <> 'aktiv' THEN RAISE EXCEPTION 'FEIL: lenken er ikke aktiv (%).', v_status; END IF;
  PERFORM 1 FROM public.career_atom_links WHERE id=v_link AND link_type='oppnadd_i' AND to_atom_id=v_role AND from_atom_id=v_atom;
  IF NOT FOUND THEN RAISE EXCEPTION 'FEIL: lenken har feil type/retning'; END IF;

  SELECT parent_atom_id, source_type INTO v_parent, v_src FROM public.career_atoms WHERE id=v_atom;
  IF v_parent IS DISTINCT FROM v_role THEN RAISE EXCEPTION 'FEIL: parent_atom_id % <> rolle %', v_parent, v_role; END IF;
  IF v_src <> 'user_input' THEN RAISE EXCEPTION 'FEIL: source_type %', v_src; END IF;
  PERFORM 1 FROM public.career_atom_parent_projection WHERE atom_id=v_atom AND link_id=v_link;
  IF NOT FOUND THEN RAISE EXCEPTION 'FEIL: projeksjonsraden mangler'; END IF;

  UPDATE public.career_atoms SET structured_data = structured_data || jsonb_build_object('end_date','2021-06-01')
  WHERE id = v_role;

  SELECT status INTO v_status FROM public.career_atom_links WHERE id=v_link;
  SELECT parent_atom_id INTO v_parent FROM public.career_atoms WHERE id=v_atom;
  IF v_status <> 'trenger_ny_vurdering' THEN RAISE EXCEPTION 'FEIL: endret rolle ga status %', v_status; END IF;
  IF v_parent IS NOT NULL THEN RAISE EXCEPTION 'FEIL: parent_atom_id ikke nullstilt ved endret rolle'; END IF;

  PERFORM 1 FROM public.career_atoms WHERE id=v_atom AND source_type='user_input'
    AND structured_data->>'kilde'='bruker_manuelt' AND user_confirmed;
  IF NOT FOUND THEN RAISE EXCEPTION 'FEIL: provenance tapt'; END IF;
  SELECT count(*) INTO v_cnt FROM public.career_atom_links WHERE from_atom_id=v_atom;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'FEIL: lenkehistorikk (% rader)', v_cnt; END IF;

  UPDATE public.career_atom_links SET status='aktiv' WHERE id=v_link;
  PERFORM public.career_atom_project_parent(v_atom);
  SELECT parent_atom_id INTO v_parent FROM public.career_atoms WHERE id=v_atom;
  IF v_parent IS DISTINCT FROM v_role THEN RAISE EXCEPTION 'FEIL: reprojeksjon feilet'; END IF;

  UPDATE public.career_atoms SET is_active=false WHERE id=v_role;
  SELECT status INTO v_status FROM public.career_atom_links WHERE id=v_link;
  SELECT parent_atom_id INTO v_parent FROM public.career_atoms WHERE id=v_atom;
  IF v_status <> 'trenger_ny_vurdering' OR v_parent IS NOT NULL THEN
    RAISE EXCEPTION 'FEIL: arkivert rolle ga status % / parent %', v_status, v_parent;
  END IF;

  DELETE FROM public.career_atom_parent_projection WHERE atom_id=v_atom;
  DELETE FROM public.career_atom_evidence_projection WHERE atom_id=v_atom;
  DELETE FROM public.career_atom_links WHERE id=v_link;
  DELETE FROM public.career_atoms WHERE id IN (v_atom, v_role);

  RAISE NOTICE 'SELFTEST OK';
END $$;