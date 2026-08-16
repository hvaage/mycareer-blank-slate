CREATE OR REPLACE FUNCTION public.career_atom_add_manual_result(
  p_title text,
  p_role_atom_id uuid,
  p_review_import_id uuid DEFAULT NULL,
  p_structured_data jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_role public.career_atoms%ROWTYPE;
  v_import uuid := p_review_import_id;
  v_title text := btrim(COALESCE(p_title, ''));
  v_structured jsonb;
  v_atom_id uuid;
  v_link_id uuid;
  v_parent uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Ikke innlogget'; END IF;
  IF v_title = '' THEN RAISE EXCEPTION 'Resultatet må ha en beskrivelse.'; END IF;

  SELECT * INTO v_role FROM public.career_atoms WHERE id = p_role_atom_id;
  IF v_role.id IS NULL OR v_role.user_id <> v_user THEN
    RAISE EXCEPTION 'Ikke tilgang til rollen';
  END IF;
  IF NOT v_role.is_active THEN
    RAISE EXCEPTION 'Rollen er arkivert';
  END IF;
  IF v_role.atom_type <> 'role' THEN
    RAISE EXCEPTION 'Resultat må plasseres under en rolle';
  END IF;

  IF v_import IS NOT NULL THEN
    PERFORM 1 FROM public.cv_imports WHERE id = v_import AND user_id = v_user;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ukjent import'; END IF;
  ELSE
    SELECT id INTO v_import FROM public.cv_imports
    WHERE user_id = v_user ORDER BY created_at DESC LIMIT 1;
    IF v_import IS NULL THEN
      RAISE EXCEPTION 'Mangler importkontekst for manuelt resultat';
    END IF;
  END IF;

  v_structured := COALESCE(p_structured_data, '{}'::jsonb)
    || jsonb_build_object(
         'lagt_inn_av_bruker', true,
         'kilde', 'bruker_manuelt',
         'review_import_id', v_import,
         'role_atom_id', p_role_atom_id
       );

  INSERT INTO public.career_atoms (
    user_id, atom_kind, atom_type, content_no, structured_data,
    source_type, source_ref, confidence, user_confirmed,
    refreshed_at, last_seen_at
  ) VALUES (
    v_user, 'evidens', 'achievement', v_title, v_structured,
    'user_input', 'cv_review_results', 'verified', true,
    now(), now()
  ) RETURNING id INTO v_atom_id;

  INSERT INTO public.career_atom_links (
    user_id, from_atom_id, to_atom_id, link_type, decided_by, status,
    confidence, reasons, review_import_id, decided_at, decided_by_user_id
  ) VALUES (
    v_user, v_atom_id, p_role_atom_id, 'oppnadd_i', 'user_confirmed', 'aktiv',
    'hoy', jsonb_build_object('kilde', 'bruker_manuelt'), v_import, now(), v_user
  ) RETURNING id INTO v_link_id;

  PERFORM public.career_atom_project_parent(v_atom_id);

  SELECT parent_atom_id INTO v_parent FROM public.career_atoms WHERE id = v_atom_id;

  RETURN jsonb_build_object(
    'atom_id', v_atom_id,
    'link_id', v_link_id,
    'parent_atom_id', v_parent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.career_atom_add_manual_result(text,uuid,uuid,jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.career_atom_add_manual_result(text,uuid,uuid,jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.career_atoms_recheck_links_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_changed boolean := false;
  v_ids uuid[];
  v_id uuid;
BEGIN
  IF OLD.is_active AND NOT NEW.is_active THEN
    v_changed := true;
  ELSIF NEW.atom_type = 'role' AND (
      NEW.content_no IS DISTINCT FROM OLD.content_no
      OR NEW.structured_data->>'employer' IS DISTINCT FROM OLD.structured_data->>'employer'
      OR NEW.structured_data->>'start_date' IS DISTINCT FROM OLD.structured_data->>'start_date'
      OR NEW.structured_data->>'end_date' IS DISTINCT FROM OLD.structured_data->>'end_date'
    ) THEN
    v_changed := true;
  END IF;

  IF NOT v_changed THEN RETURN NEW; END IF;

  WITH upd AS (
    UPDATE public.career_atom_links
    SET status = 'trenger_ny_vurdering'
    WHERE superseded_at IS NULL
      AND status IN ('aktiv','foreslatt')
      AND (from_atom_id = NEW.id OR to_atom_id = NEW.id)
    RETURNING from_atom_id
  )
  SELECT COALESCE(array_agg(DISTINCT from_atom_id), '{}') INTO v_ids FROM upd;

  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM public.career_atom_project_evidence(v_id);
    PERFORM public.career_atom_project_parent(v_id);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS career_atoms_recheck_links_trg ON public.career_atoms;
CREATE TRIGGER career_atoms_recheck_links_trg
AFTER UPDATE ON public.career_atoms
FOR EACH ROW EXECUTE FUNCTION public.career_atoms_recheck_links_trigger();