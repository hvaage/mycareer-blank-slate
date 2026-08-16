DO $$
DECLARE
  v_user uuid;
  v_role uuid; v_res uuid; v_skill uuid; v_skill2 uuid;
  v_impact jsonb; v_del jsonb; v_left int;
BEGIN
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  IF v_user IS NULL THEN RAISE NOTICE 'KANARI: ingen bruker, hopper over'; RETURN; END IF;

  INSERT INTO public.career_atoms(user_id, atom_kind, atom_type, content_no, source_type)
  VALUES (v_user, 'evidens', 'role', 'KANARI rolle', 'manual') RETURNING id INTO v_role;

  INSERT INTO public.career_atoms(user_id, atom_kind, atom_type, parent_atom_id, content_no, source_type)
  VALUES (v_user, 'evidens', 'achievement', v_role, 'KANARI resultat', 'manual') RETURNING id INTO v_res;

  -- kompetanse med kun dette belegget -> skal bli foreldreløs
  INSERT INTO public.career_atoms(user_id, atom_kind, atom_type, content_no, evidence_atom_ids, source_type)
  VALUES (v_user, 'evidens', 'skill', 'KANARI kompetanse', ARRAY[v_res], 'manual') RETURNING id INTO v_skill;

  -- kompetanse med to belegg -> skal bare svekkes
  INSERT INTO public.career_atoms(user_id, atom_kind, atom_type, content_no, evidence_atom_ids, source_type)
  VALUES (v_user, 'evidens', 'skill', 'KANARI kompetanse med to belegg', ARRAY[v_res, v_role], 'manual') RETURNING id INTO v_skill2;

  v_impact := public.career_atom_delete_impact(v_role);
  RAISE NOTICE 'KANARI impact: found=% desc=% orphan=% weak=%',
    v_impact->>'found',
    jsonb_array_length(v_impact->'descendants'),
    jsonb_array_length(v_impact->'orphaned'),
    jsonb_array_length(v_impact->'weakened');

  IF (v_impact->>'found')::boolean IS NOT TRUE
     OR jsonb_array_length(v_impact->'descendants') <> 1
     OR jsonb_array_length(v_impact->'orphaned') <> 2 THEN
    RAISE EXCEPTION 'KANARI: konsekvensoppslaget ga feil struktur: %', v_impact;
  END IF;

  v_del := public.career_atom_delete(v_role);
  RAISE NOTICE 'KANARI delete: %', v_del;

  SELECT count(*) INTO v_left FROM public.career_atoms WHERE content_no LIKE 'KANARI%';
  IF v_left <> 0 THEN
    DELETE FROM public.career_atoms WHERE content_no LIKE 'KANARI%';
    RAISE EXCEPTION 'KANARI: % rader sto igjen etter sletting', v_left;
  END IF;

  IF (public.career_atom_delete_impact(v_role)->>'found')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'KANARI: slettet id ga ikke tom struktur';
  END IF;

  RAISE NOTICE 'KANARI OK';
END $$;