CREATE OR REPLACE FUNCTION public.career_atom_project_evidence(p_atom_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid;
  v_desired uuid[];
BEGIN
  SELECT user_id INTO v_user FROM public.career_atoms WHERE id = p_atom_id;
  IF v_user IS NULL THEN RETURN; END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> v_user THEN
    RAISE EXCEPTION 'Ikke tilgang';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT l.to_atom_id), '{}')
  INTO v_desired
  FROM public.career_atom_links l
  JOIN public.career_atoms t ON t.id = l.to_atom_id
  JOIN public.career_atoms f ON f.id = l.from_atom_id
  WHERE l.from_atom_id = p_atom_id
    AND l.link_type IN ('belegges_av','avledet_av')
    AND l.status = 'aktiv'
    AND l.superseded_at IS NULL
    AND t.is_active
    AND f.is_active;

  DELETE FROM public.career_atom_evidence_projection
  WHERE atom_id = p_atom_id
    AND NOT (referenced_atom_id = ANY (v_desired));

  INSERT INTO public.career_atom_evidence_projection (user_id, atom_id, referenced_atom_id, link_id)
  SELECT v_user, p_atom_id, l.to_atom_id, (min(l.id::text))::uuid
  FROM public.career_atom_links l
  WHERE l.from_atom_id = p_atom_id
    AND l.link_type IN ('belegges_av','avledet_av')
    AND l.status = 'aktiv'
    AND l.superseded_at IS NULL
    AND l.to_atom_id = ANY (v_desired)
  GROUP BY l.to_atom_id
  ON CONFLICT (atom_id, referenced_atom_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.career_atom_project_evidence(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.career_atom_project_evidence(uuid) TO service_role;