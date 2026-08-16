-- 5b: konsekvensoppslag og sletting for career_atoms.
-- Begge kjører som SECURITY INVOKER, slik at RLS avgjør synlighet:
-- ukjent eller fremmed atom_id gir tom struktur, ikke feil.

CREATE OR REPLACE FUNCTION public.career_atom_delete_impact(p_atom_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH RECURSIVE root AS (
  SELECT * FROM public.career_atoms WHERE id = p_atom_id
),
tree AS (
  SELECT c.*, 0 AS depth FROM public.career_atoms c JOIN root r ON c.id = r.id
  UNION ALL
  SELECT c.*, t.depth + 1
  FROM public.career_atoms c
  JOIN tree t ON c.parent_atom_id = t.id
  WHERE t.depth < 10
),
removed AS (
  SELECT id FROM tree
),
referrers AS (
  SELECT
    c.id,
    c.content_no,
    c.atom_kind,
    c.atom_type,
    c.atom_class,
    cardinality(COALESCE(c.evidence_atom_ids, '{}')) AS links_total,
    cardinality(ARRAY(
      SELECT unnest(COALESCE(c.evidence_atom_ids, '{}'))
      INTERSECT
      SELECT id FROM removed
    )) AS links_lost
  FROM public.career_atoms c
  WHERE c.is_active
    AND c.id NOT IN (SELECT id FROM removed)
    AND COALESCE(c.evidence_atom_ids, '{}') && ARRAY(SELECT id FROM removed)
)
SELECT jsonb_build_object(
  'found', (SELECT count(*) > 0 FROM root),
  'atom', (
    SELECT jsonb_build_object(
      'id', r.id, 'content_no', r.content_no, 'atom_kind', r.atom_kind,
      'atom_type', r.atom_type, 'atom_class', r.atom_class
    ) FROM root r
  ),
  'descendants', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', t.id, 'content_no', t.content_no, 'atom_kind', t.atom_kind,
      'atom_type', t.atom_type, 'atom_class', t.atom_class, 'depth', t.depth
    ) ORDER BY t.depth, t.content_no)
    FROM tree t WHERE t.depth > 0
  ), '[]'::jsonb),
  'orphaned', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', f.id, 'content_no', f.content_no, 'atom_kind', f.atom_kind,
      'atom_type', f.atom_type, 'atom_class', f.atom_class,
      'links_total', f.links_total, 'links_lost', f.links_lost
    ) ORDER BY f.content_no)
    FROM referrers f WHERE f.links_lost >= f.links_total
  ), '[]'::jsonb),
  'weakened', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', f.id, 'content_no', f.content_no, 'atom_kind', f.atom_kind,
      'atom_type', f.atom_type, 'atom_class', f.atom_class,
      'links_total', f.links_total, 'links_lost', f.links_lost
    ) ORDER BY f.content_no)
    FROM referrers f WHERE f.links_lost < f.links_total
  ), '[]'::jsonb),
  'parse_candidates', COALESCE((
    SELECT count(*) FROM public.cv_parse_candidates p
    WHERE p.promoted_atom_id IN (SELECT id FROM removed)
  ), 0)
);
$$;

REVOKE ALL ON FUNCTION public.career_atom_delete_impact(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.career_atom_delete_impact(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.career_atom_delete_impact(uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.career_atom_delete(p_atom_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_removed uuid[];
  v_unlinked int := 0;
  v_orphaned int := 0;
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
    RETURN jsonb_build_object('found', false, 'deleted', 0, 'unlinked', 0, 'orphaned', 0);
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
  SELECT count(*) INTO v_unlinked FROM upd;

  DELETE FROM public.career_atoms WHERE id = ANY(v_removed);

  -- Kompetanse/eksponering uten belegg igjen kan ikke stå alene.
  WITH orph AS (
    DELETE FROM public.career_atoms c
    WHERE c.atom_kind = 'evidens'
      AND c.atom_class IN ('kompetanse', 'eksponering')
      AND c.parent_atom_id IS NULL
      AND cardinality(COALESCE(c.evidence_atom_ids, '{}')) = 0
    RETURNING c.id
  )
  SELECT count(*) INTO v_orphaned FROM orph;

  RETURN jsonb_build_object(
    'found', true,
    'deleted', cardinality(v_removed),
    'unlinked', v_unlinked,
    'orphaned', v_orphaned
  );
END;
$$;

REVOKE ALL ON FUNCTION public.career_atom_delete(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.career_atom_delete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.career_atom_delete(uuid) TO service_role;