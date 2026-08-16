CREATE OR REPLACE FUNCTION public.career_atom_delete(p_atom_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_removed uuid[];
  v_touched uuid[];
  v_unlinked int := 0;
  v_unbacked int := 0;
BEGIN
  WITH RECURSIVE tree AS (
    SELECT c.id, 0 AS depth FROM public.career_atoms c WHERE c.id = p_atom_id
    UNION ALL
    SELECT c.id, t.depth + 1
    FROM public.career_atoms c JOIN tree t ON c.parent_atom_id = t.id
    WHERE t.depth < 10
  )
  SELECT COALESCE(array_agg(id), '{}') INTO v_removed FROM tree;

  IF cardinality(v_removed) = 0 THEN
    RETURN jsonb_build_object('found', false, 'deleted', 0, 'unlinked', 0, 'unbacked', 0, 'orphaned', 0);
  END IF;

  -- Fjern pekere til det slettede fra kompetanse/eksponering som pekte hit.
  WITH upd AS (
    UPDATE public.career_atoms c
    SET evidence_atom_ids = ARRAY(
      SELECT unnest(COALESCE(c.evidence_atom_ids, '{}')) EXCEPT SELECT unnest(v_removed)
    )
    WHERE c.is_active
      AND NOT (c.id = ANY(v_removed))
      AND COALESCE(c.evidence_atom_ids, '{}') && v_removed
    RETURNING c.id
  )
  SELECT COALESCE(array_agg(id), '{}'), count(*) INTO v_touched, v_unlinked FROM upd;

  DELETE FROM public.career_atoms WHERE id = ANY(v_removed);

  -- Kompetanse/eksponering som mistet hele belegget sitt beholdes, men
  -- nedgraderes og merkes som ubelagt. Brukeren har fortsatt kompetansen;
  -- det er dokumentasjonen som falt bort. Sletting er brukerens valg.
  WITH unb AS (
    UPDATE public.career_atoms c
    SET confidence = 'inferred',
        structured_data = COALESCE(c.structured_data, '{}'::jsonb)
          || jsonb_build_object('mangler_belegg', true, 'mangler_belegg_siden', now()),
        updated_at = now()
    WHERE c.id = ANY(v_touched)
      AND c.atom_kind = 'evidens'
      AND c.atom_class IN ('kompetanse', 'eksponering')
      AND c.parent_atom_id IS NULL
      AND cardinality(COALESCE(c.evidence_atom_ids, '{}')) = 0
    RETURNING c.id
  )
  SELECT count(*) INTO v_unbacked FROM unb;

  RETURN jsonb_build_object(
    'found', true,
    'deleted', cardinality(v_removed),
    'unlinked', v_unlinked,
    'unbacked', v_unbacked,
    'orphaned', 0
  );
END;
$function$;