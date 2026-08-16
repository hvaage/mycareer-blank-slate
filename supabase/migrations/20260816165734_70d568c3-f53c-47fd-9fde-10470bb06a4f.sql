-- Fase 3B, guard: én parsekandidat kan nå career_atoms via nøyaktig én vei.

CREATE UNIQUE INDEX IF NOT EXISTS career_atoms_parse_candidate_unique
  ON public.career_atoms (((structured_data ->> 'parse_candidate_id')))
  WHERE (structured_data ->> 'parse_candidate_id') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.career_atom_sync_parse_candidate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
         resolved_atom_type = pg_catalog.coalesce(resolved_atom_type, NEW.atom_type),
         promoted_atom_id = NEW.id,
         reviewed_at = pg_catalog.coalesce(reviewed_at, pg_catalog.now()),
         updated_at = pg_catalog.now()
   WHERE id = v_id;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.career_atom_sync_parse_candidate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS career_atoms_sync_parse_candidate ON public.career_atoms;
CREATE TRIGGER career_atoms_sync_parse_candidate
AFTER INSERT ON public.career_atoms
FOR EACH ROW EXECUTE FUNCTION public.career_atom_sync_parse_candidate();

-- Ingen duplikate forslag for samme kandidat og samme kildesignatur.
CREATE UNIQUE INDEX IF NOT EXISTS atom_enrichment_proposals_parse_candidate_unique
  ON public.atom_enrichment_proposals (user_id, source_record_id, source_hash)
  WHERE source_table = 'cv_parse_candidates'
    AND status IN ('pending_review', 'approved');