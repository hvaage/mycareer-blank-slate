-- Ensure updated_at helper exists (idempotent)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =============================================================
-- Table: cv_evidence_atoms
-- =============================================================
CREATE TABLE public.cv_evidence_atoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  atom_type text NOT NULL CHECK (atom_type IN (
    'role','achievement','metric','context','tool',
    'education','skill','language','certification',
    'project','volunteer','summary_fragment'
  )),
  parent_atom_id uuid REFERENCES public.cv_evidence_atoms(id) ON DELETE CASCADE,
  content_no text,
  content_en text,
  structured_data jsonb,
  source_type text NOT NULL CHECK (source_type IN (
    'linkedin_oauth','linkedin_zip','linkedin_pdf',
    'old_cv_pdf','old_cv_docx','interview',
    'manual','about_me_profile','onboarding'
  )),
  source_ref text,
  source_quote text,
  confidence text NOT NULL DEFAULT 'imported' CHECK (confidence IN (
    'verified','imported','inferred'
  )),
  user_confirmed boolean NOT NULL DEFAULT false,
  user_locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cv_evidence_atoms IS
  'Atomic evidence for CV generation. Each row is one verified fact about user career history.';
COMMENT ON COLUMN public.cv_evidence_atoms.parent_atom_id IS
  'For hierarchical atoms: achievement -> role, metric -> achievement, context/tool -> role.';
COMMENT ON COLUMN public.cv_evidence_atoms.confidence IS
  'verified = user confirmed, imported = from external source not yet confirmed, inferred = AI-filled gap not safe to use until confirmed.';

-- =============================================================
-- Table: cv_imports
-- =============================================================
CREATE TABLE public.cv_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_type text NOT NULL CHECK (import_type IN (
    'linkedin_zip','linkedin_pdf','old_cv_pdf','old_cv_docx','manual'
  )),
  source_filename text,
  source_file_path text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','processing','parsed','reviewed','committed','failed'
  )),
  raw_parsed_data jsonb,
  atoms_created_count integer NOT NULL DEFAULT 0,
  atoms_committed_count integer NOT NULL DEFAULT 0,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  parsed_at timestamptz,
  committed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cv_imports IS
  'Tracks one CV-import job per row. Lifecycle: pending -> processing -> parsed -> reviewed -> committed.';
COMMENT ON COLUMN public.cv_imports.raw_parsed_data IS
  'Intermediate parser output before conversion to atoms. Cleared after committed status to save space.';

-- =============================================================
-- Table: cv_consent_log
-- =============================================================
CREATE TABLE public.cv_consent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_type text NOT NULL CHECK (consent_type IN (
    'birth_year','profile_photo','nationality',
    'marital_status','address','data_processing'
  )),
  consent_given boolean NOT NULL DEFAULT false,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  context text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cv_consent_log IS
  'Audit trail of user consent for optional CV fields and data processing. Append-only - revocation creates new row, not update.';

-- =============================================================
-- Extend documents
-- =============================================================
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS atom_ids uuid[],
  ADD COLUMN IF NOT EXISTS atom_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS render_template_version text,
  ADD COLUMN IF NOT EXISTS ats_rules_version text,
  ADD COLUMN IF NOT EXISTS guard_version text,
  ADD COLUMN IF NOT EXISTS guard_result jsonb,
  ADD COLUMN IF NOT EXISTS quality_result jsonb,
  ADD COLUMN IF NOT EXISTS render_language text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documents_render_language_check'
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_render_language_check
      CHECK (render_language IS NULL OR render_language IN ('no','en'));
  END IF;
END$$;

COMMENT ON COLUMN public.documents.atom_ids IS
  'Array of cv_evidence_atoms.id used to render this document. Lets us trace each line back to source.';
COMMENT ON COLUMN public.documents.atom_snapshot IS
  'Frozen snapshot of atom content at render time. Used for reproducibility - atoms may change later but document remains stable.';
COMMENT ON COLUMN public.documents.guard_result IS
  'Output from cv-hallucination-guard at render time. Lets us see which claims were verified vs unverified.';
COMMENT ON COLUMN public.documents.quality_result IS
  'Output from cv-quality-no at render time. Tracks which quality issues were flagged or fixed.';

-- =============================================================
-- Indexes
-- =============================================================
CREATE INDEX idx_cv_atoms_user_id ON public.cv_evidence_atoms(user_id);
CREATE INDEX idx_cv_atoms_user_type ON public.cv_evidence_atoms(user_id, atom_type);
CREATE INDEX idx_cv_atoms_user_confirmed ON public.cv_evidence_atoms(user_id, user_confirmed);
CREATE INDEX idx_cv_atoms_parent ON public.cv_evidence_atoms(parent_atom_id) WHERE parent_atom_id IS NOT NULL;
CREATE INDEX idx_cv_atoms_source ON public.cv_evidence_atoms(user_id, source_type, source_ref) WHERE source_ref IS NOT NULL;

CREATE INDEX idx_cv_imports_user_status ON public.cv_imports(user_id, status);
CREATE INDEX idx_cv_imports_user_started ON public.cv_imports(user_id, started_at DESC);

CREATE INDEX idx_cv_consent_user_type ON public.cv_consent_log(user_id, consent_type, granted_at DESC);

CREATE INDEX IF NOT EXISTS idx_documents_atom_ids ON public.documents USING GIN(atom_ids) WHERE atom_ids IS NOT NULL;

-- =============================================================
-- Row Level Security
-- =============================================================
ALTER TABLE public.cv_evidence_atoms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cv_atoms_select_own"
  ON public.cv_evidence_atoms FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "cv_atoms_insert_own"
  ON public.cv_evidence_atoms FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cv_atoms_update_own"
  ON public.cv_evidence_atoms FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cv_atoms_delete_own"
  ON public.cv_evidence_atoms FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.cv_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cv_imports_select_own"
  ON public.cv_imports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "cv_imports_insert_own"
  ON public.cv_imports FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cv_imports_update_own"
  ON public.cv_imports FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cv_imports_delete_own"
  ON public.cv_imports FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.cv_consent_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cv_consent_select_own"
  ON public.cv_consent_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "cv_consent_insert_own"
  ON public.cv_consent_log FOR INSERT WITH CHECK (auth.uid() = user_id);

-- =============================================================
-- Triggers
-- =============================================================
CREATE TRIGGER set_cv_evidence_atoms_updated_at
  BEFORE UPDATE ON public.cv_evidence_atoms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_cv_imports_updated_at
  BEFORE UPDATE ON public.cv_imports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_cv_consent_log_updated_at
  BEFORE UPDATE ON public.cv_consent_log
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();