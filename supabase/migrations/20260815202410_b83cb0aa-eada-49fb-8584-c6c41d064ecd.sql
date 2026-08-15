-- Karriereontologi v4, fase 2.3: parselaget skilles fra evidenslaget.
-- cv_evidence_atoms er tom (verifisert) og erstattes uten datamigrering.
DROP TABLE IF EXISTS public.cv_evidence_atoms CASCADE;

CREATE TABLE public.cv_parse_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES public.cv_imports(id) ON DELETE CASCADE,

  -- Struktur innenfor parsen, ikke en atomgraf.
  local_ref text NOT NULL,
  parent_local_ref text,

  -- Parseren foreslår, gjennomgangen avgjør.
  suggested_atom_type text NOT NULL,
  resolved_atom_type text,
  suggested_from_category text,

  content_no text,
  content_en text,
  structured_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text,

  -- Sporing til hvor i kilden innholdet sto.
  source_type text NOT NULL,
  source_ref text,
  source_quote text,

  -- Parserens egen sikkerhet. Ikke v4s opprinnelsesakse.
  parse_confidence numeric(3,2),

  -- Behandlingstilstand.
  status text NOT NULL DEFAULT 'ubehandlet',
  promoted_atom_id uuid REFERENCES public.career_atoms(id) ON DELETE SET NULL,
  question_ref text,
  rejected_reason text,
  reviewed_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cv_parse_candidates_local_ref_unique UNIQUE (import_id, local_ref),
  CONSTRAINT cv_parse_candidates_status_check
    CHECK (status IN ('ubehandlet','bekreftet','avvist','ble_sporsmal')),
  CONSTRAINT cv_parse_candidates_suggested_type_check
    CHECK (suggested_atom_type IN (
      'role','achievement','metric','context','tool','education','skill',
      'domain','language','certification','project','volunteer','summary_fragment'
    )),
  CONSTRAINT cv_parse_candidates_resolved_type_check
    CHECK (resolved_atom_type IS NULL OR resolved_atom_type IN (
      'role','achievement','metric','context','tool','education','skill',
      'domain','language','certification','project','volunteer','summary_fragment'
    )),
  CONSTRAINT cv_parse_candidates_source_type_check
    CHECK (source_type IN (
      'linkedin_oauth','linkedin_zip','linkedin_pdf','old_cv_pdf','old_cv_docx',
      'interview','manual','about_me_profile','onboarding'
    )),
  CONSTRAINT cv_parse_candidates_parse_confidence_check
    CHECK (parse_confidence IS NULL OR (parse_confidence >= 0 AND parse_confidence <= 1)),
  -- Bekreftet krever både valgt type og hva den ble til.
  CONSTRAINT cv_parse_candidates_bekreftet_check
    CHECK (
      status <> 'bekreftet'
      OR (resolved_atom_type IS NOT NULL AND promoted_atom_id IS NOT NULL)
    )
);

COMMENT ON TABLE public.cv_parse_candidates IS
  'Parselaget for CV-import. Rå maskinlesning som venter på brukerens avgjørelse. Ingen ontologi-constraints her; de hører til career_atoms og innfris i gjennomgangen.';
COMMENT ON COLUMN public.cv_parse_candidates.suggested_atom_type IS 'Parserens forslag. Sammenlign med resolved_atom_type for å måle korrigeringsraten.';
COMMENT ON COLUMN public.cv_parse_candidates.suggested_from_category IS 'Hvilken av de gamle category-verdiene forslaget kom fra. Grunnlag for korrigeringsrapporten.';
COMMENT ON COLUMN public.cv_parse_candidates.parse_confidence IS '0-1, parserens egen sikkerhet. Ikke v4s confidence-akse.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cv_parse_candidates TO authenticated;
GRANT ALL ON public.cv_parse_candidates TO service_role;

ALTER TABLE public.cv_parse_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cv_parse_candidates_select_own" ON public.cv_parse_candidates
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "cv_parse_candidates_insert_own" ON public.cv_parse_candidates
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cv_parse_candidates_update_own" ON public.cv_parse_candidates
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cv_parse_candidates_delete_own" ON public.cv_parse_candidates
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_cv_parse_candidates_user_status ON public.cv_parse_candidates (user_id, status);
CREATE INDEX idx_cv_parse_candidates_import ON public.cv_parse_candidates (import_id);
CREATE INDEX idx_cv_parse_candidates_dedupe ON public.cv_parse_candidates (user_id, dedupe_key);
CREATE INDEX idx_cv_parse_candidates_promoted ON public.cv_parse_candidates (promoted_atom_id);

CREATE TRIGGER trg_cv_parse_candidates_updated_at
  BEFORE UPDATE ON public.cv_parse_candidates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();