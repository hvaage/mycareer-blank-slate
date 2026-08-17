-- 1) Ufullførte rollevalg i trinn 2 lagres som review-state på gjennomgangen.
CREATE OR REPLACE FUNCTION public.cv_review_set_role_choice(
  p_import_id uuid,
  p_signature text,
  p_candidate_id uuid,
  p_choice text
)
RETURNS public.cv_review_progress
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row public.cv_review_progress%ROWTYPE;
  v_state jsonb;
  v_choices jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Ikke innlogget'; END IF;

  PERFORM 1 FROM public.cv_parse_candidates
   WHERE id = p_candidate_id AND user_id = v_user AND import_id = p_import_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ukjent resultat i denne importen'; END IF;

  SELECT * INTO v_row FROM public.cv_review_progress
   WHERE user_id = v_user AND import_id = p_import_id AND is_stale = false
   FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Ingen aktiv gjennomgang for denne importen'; END IF;
  IF v_row.candidate_set_signature <> p_signature THEN
    RAISE EXCEPTION 'Gjennomgangen gjelder et annet kandidatsett. Start gjennomgangen på nytt.';
  END IF;

  v_state := COALESCE(v_row.step_state, '{}'::jsonb);
  v_choices := COALESCE(v_state -> 'role_choices', '{}'::jsonb);

  IF p_choice IS NULL OR btrim(p_choice) = '' THEN
    v_choices := v_choices - p_candidate_id::text;
  ELSE
    v_choices := v_choices || jsonb_build_object(p_candidate_id::text, btrim(p_choice));
  END IF;

  UPDATE public.cv_review_progress
     SET step_state = v_state || jsonb_build_object('role_choices', v_choices),
         updated_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.cv_review_set_role_choice(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cv_review_set_role_choice(uuid, text, uuid, text) TO authenticated;

-- 2) Kanonisk bekreftelse av et resultat fra parselaget: atom + aktiv
--    oppnadd_i-lenke + projeksjon. parent_atom_id skrives aldri direkte.
CREATE OR REPLACE FUNCTION public.cv_review_promote_result(
  p_candidate_id uuid,
  p_role_atom_id uuid,
  p_resolved_type text DEFAULT 'achievement'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_cand public.cv_parse_candidates%ROWTYPE;
  v_role public.career_atoms%ROWTYPE;
  v_type text := COALESCE(NULLIF(btrim(p_resolved_type), ''), 'achievement');
  v_atom_id uuid;
  v_link_id uuid;
  v_title text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Ikke innlogget'; END IF;
  IF v_type NOT IN ('achievement','metric','project','volunteer') THEN
    RAISE EXCEPTION 'Ugyldig resultattype';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_candidate_id::text, 43));

  SELECT * INTO v_cand FROM public.cv_parse_candidates
   WHERE id = p_candidate_id AND user_id = v_user;
  IF v_cand.id IS NULL THEN RAISE EXCEPTION 'Ukjent resultat'; END IF;

  SELECT * INTO v_role FROM public.career_atoms WHERE id = p_role_atom_id;
  IF v_role.id IS NULL OR v_role.user_id <> v_user THEN RAISE EXCEPTION 'Ikke tilgang til rollen'; END IF;
  IF NOT v_role.is_active THEN RAISE EXCEPTION 'Rollen er arkivert'; END IF;
  IF v_role.atom_type <> 'role' THEN RAISE EXCEPTION 'Resultat må plasseres under en rolle'; END IF;

  v_atom_id := v_cand.promoted_atom_id;
  IF v_atom_id IS NULL THEN
    SELECT id INTO v_atom_id FROM public.career_atoms
     WHERE user_id = v_user
       AND (structured_data ->> 'parse_candidate_id') = p_candidate_id::text
     LIMIT 1;
  END IF;

  IF v_atom_id IS NULL THEN
    v_title := btrim(COALESCE(v_cand.content_no, v_cand.content_en, ''));
    IF v_title = '' THEN RAISE EXCEPTION 'Resultatet mangler tekst'; END IF;

    INSERT INTO public.career_atoms (
      user_id, atom_kind, atom_type, content_no, content_en, structured_data,
      source_type, source_ref, source_quote, confidence, user_confirmed,
      refreshed_at, last_seen_at
    ) VALUES (
      v_user, 'evidens', v_type, v_title, v_cand.content_en,
      COALESCE(v_cand.structured_data, '{}'::jsonb)
        || jsonb_build_object(
             'parse_candidate_id', p_candidate_id::text,
             'parse_local_ref', v_cand.local_ref,
             'import_id', v_cand.import_id,
             'suggested_atom_type', v_cand.suggested_atom_type,
             'role_atom_id', p_role_atom_id
           ),
      COALESCE(v_cand.source_type, 'cv_import'), v_cand.source_ref, v_cand.source_quote,
      'verified', true, now(), now()
    ) RETURNING id INTO v_atom_id;
  END IF;

  -- Én aktiv oppnadd_i-lenke: tidligere plasseringer avløses.
  UPDATE public.career_atom_links
     SET status = 'avvist', superseded_at = now()
   WHERE user_id = v_user
     AND from_atom_id = v_atom_id
     AND link_type = 'oppnadd_i'
     AND status = 'aktiv'
     AND superseded_at IS NULL
     AND to_atom_id <> p_role_atom_id;

  SELECT id INTO v_link_id FROM public.career_atom_links
   WHERE user_id = v_user AND from_atom_id = v_atom_id AND to_atom_id = p_role_atom_id
     AND link_type = 'oppnadd_i' AND status = 'aktiv' AND superseded_at IS NULL
   LIMIT 1;

  IF v_link_id IS NULL THEN
    INSERT INTO public.career_atom_links (
      user_id, from_atom_id, to_atom_id, link_type, decided_by, status,
      confidence, reasons, review_import_id, decided_at, decided_by_user_id
    ) VALUES (
      v_user, v_atom_id, p_role_atom_id, 'oppnadd_i', 'user_confirmed', 'aktiv',
      'hoy', jsonb_build_object('kilde', 'cv_review_trinn2'), v_cand.import_id, now(), v_user
    ) RETURNING id INTO v_link_id;
  END IF;

  PERFORM public.career_atom_project_parent(v_atom_id);

  UPDATE public.cv_parse_candidates
     SET status = 'bekreftet',
         resolved_atom_type = v_type,
         promoted_atom_id = v_atom_id,
         reviewed_at = COALESCE(reviewed_at, now()),
         updated_at = now()
   WHERE id = p_candidate_id AND user_id = v_user;

  RETURN jsonb_build_object('atom_id', v_atom_id, 'link_id', v_link_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.cv_review_promote_result(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cv_review_promote_result(uuid, uuid, text) TO authenticated;