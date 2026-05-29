-- Min dokumentasjon – foundation (non-destructive)
-- Extends public.documents and public.cv_evidence_atoms; adds case/result/evidence tables,
-- RLS, indexes, updated_at triggers, and public.career_atoms view.
-- Depends on prior migrations defining public.documents, public.cv_evidence_atoms,
-- and public.update_updated_at_column().

-- ---------------------------------------------------------------------------
-- 1. documents – documentation metadata
-- ---------------------------------------------------------------------------
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS documentation_category text,
  ADD COLUMN IF NOT EXISTS documentation_subcategory text,
  ADD COLUMN IF NOT EXISTS documentation_status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS visibility text DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS confidentiality_level text DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS source_context text,
  ADD COLUMN IF NOT EXISTS extracted_text text,
  ADD COLUMN IF NOT EXISTS ai_summary text,
  ADD COLUMN IF NOT EXISTS ai_processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS embedding_status text DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS career_stage_relevance text[],
  ADD COLUMN IF NOT EXISTS role_relevance_tags text[],
  ADD COLUMN IF NOT EXISTS evidence_strength numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_portfolio_featured boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.documents'::regclass
      AND c.conname = 'documents_documentation_status_check'
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_documentation_status_check
      CHECK (documentation_status IN ('active', 'archived', 'deleted'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.documents'::regclass
      AND c.conname = 'documents_visibility_check'
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_visibility_check
      CHECK (visibility IN ('private', 'shared', 'public', 'restricted'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.documents'::regclass
      AND c.conname = 'documents_confidentiality_level_check'
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_confidentiality_level_check
      CHECK (confidentiality_level IN ('normal', 'sensitive', 'confidential'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.documents'::regclass
      AND c.conname = 'documents_embedding_status_check'
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_embedding_status_check
      CHECK (embedding_status IN ('not_started', 'queued', 'processing', 'completed', 'failed'));
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 2. cv_evidence_atoms – career-wide evidence fields (table not renamed)
-- ---------------------------------------------------------------------------
ALTER TABLE public.cv_evidence_atoms
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS canonical_atom_id uuid REFERENCES public.cv_evidence_atoms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS evidence_scope text DEFAULT 'cv',
  ADD COLUMN IF NOT EXISTS career_stage_relevance text[],
  ADD COLUMN IF NOT EXISTS role_relevance_tags text[],
  ADD COLUMN IF NOT EXISTS relevance_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz DEFAULT now();

-- ---------------------------------------------------------------------------
-- 3. professional_cases, professional_results, case_documents, atom_evidence_links
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.professional_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  summary text,
  situation text,
  responsibility text,
  actions_taken text,
  results text,
  company_name text,
  industry text,
  role_context text,
  time_period text,
  visibility text NOT NULL DEFAULT 'private',
  status text NOT NULL DEFAULT 'draft',
  career_stage_relevance text[],
  role_relevance_tags text[],
  atom_ids uuid[],
  ai_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.professional_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  metric_name text,
  metric_value text,
  metric_unit text,
  baseline_value text,
  final_value text,
  time_period text,
  company_name text,
  role_context text,
  verified boolean NOT NULL DEFAULT false,
  visibility text NOT NULL DEFAULT 'private',
  atom_ids uuid[],
  evidence_strength numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.case_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.professional_cases(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  relationship_type text NOT NULL DEFAULT 'supporting',
  display_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, document_id)
);

CREATE TABLE IF NOT EXISTS public.atom_evidence_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  atom_id uuid NOT NULL REFERENCES public.cv_evidence_atoms(id) ON DELETE CASCADE,
  evidence_type text NOT NULL,
  evidence_id uuid NOT NULL,
  evidence_label text,
  strength_score numeric DEFAULT 0,
  ai_generated boolean NOT NULL DEFAULT false,
  manually_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (atom_id, evidence_type, evidence_id)
);

-- ---------------------------------------------------------------------------
-- 4. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_documents_user_category
  ON public.documents (user_id, documentation_category);

CREATE INDEX IF NOT EXISTS idx_documents_user_status
  ON public.documents (user_id, documentation_status);

CREATE INDEX IF NOT EXISTS idx_documents_role_tags
  ON public.documents USING gin (role_relevance_tags);

CREATE INDEX IF NOT EXISTS idx_documents_career_stage
  ON public.documents USING gin (career_stage_relevance);

CREATE INDEX IF NOT EXISTS idx_cv_evidence_atoms_dedupe_key
  ON public.cv_evidence_atoms (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cv_evidence_atoms_canonical_atom_id
  ON public.cv_evidence_atoms (canonical_atom_id)
  WHERE canonical_atom_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_atom_evidence_links_atom
  ON public.atom_evidence_links (atom_id);

CREATE INDEX IF NOT EXISTS idx_atom_evidence_links_user_type
  ON public.atom_evidence_links (user_id, evidence_type);

CREATE INDEX IF NOT EXISTS idx_professional_cases_user
  ON public.professional_cases (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_professional_results_user
  ON public.professional_results (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_case_documents_case
  ON public.case_documents (case_id);

CREATE INDEX IF NOT EXISTS idx_case_documents_document
  ON public.case_documents (document_id);

CREATE INDEX IF NOT EXISTS idx_case_documents_user
  ON public.case_documents (user_id);

-- ---------------------------------------------------------------------------
-- 5. Row level security (new tables only)
-- ---------------------------------------------------------------------------
ALTER TABLE public.professional_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atom_evidence_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "professional_cases_select_own" ON public.professional_cases;
DROP POLICY IF EXISTS "professional_cases_insert_own" ON public.professional_cases;
DROP POLICY IF EXISTS "professional_cases_update_own" ON public.professional_cases;
DROP POLICY IF EXISTS "professional_cases_delete_own" ON public.professional_cases;

CREATE POLICY "professional_cases_select_own"
  ON public.professional_cases FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "professional_cases_insert_own"
  ON public.professional_cases FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "professional_cases_update_own"
  ON public.professional_cases FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "professional_cases_delete_own"
  ON public.professional_cases FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "professional_results_select_own" ON public.professional_results;
DROP POLICY IF EXISTS "professional_results_insert_own" ON public.professional_results;
DROP POLICY IF EXISTS "professional_results_update_own" ON public.professional_results;
DROP POLICY IF EXISTS "professional_results_delete_own" ON public.professional_results;

CREATE POLICY "professional_results_select_own"
  ON public.professional_results FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "professional_results_insert_own"
  ON public.professional_results FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "professional_results_update_own"
  ON public.professional_results FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "professional_results_delete_own"
  ON public.professional_results FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "case_documents_select_own" ON public.case_documents;
DROP POLICY IF EXISTS "case_documents_insert_own" ON public.case_documents;
DROP POLICY IF EXISTS "case_documents_update_own" ON public.case_documents;
DROP POLICY IF EXISTS "case_documents_delete_own" ON public.case_documents;

CREATE POLICY "case_documents_select_own"
  ON public.case_documents FOR SELECT
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.professional_cases pc
      WHERE pc.id = case_id AND pc.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.user_id = auth.uid()
    )
  );

CREATE POLICY "case_documents_insert_own"
  ON public.case_documents FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.professional_cases pc
      WHERE pc.id = case_id AND pc.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.user_id = auth.uid()
    )
  );

CREATE POLICY "case_documents_update_own"
  ON public.case_documents FOR UPDATE
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.professional_cases pc
      WHERE pc.id = case_id AND pc.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.professional_cases pc
      WHERE pc.id = case_id AND pc.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.user_id = auth.uid()
    )
  );

CREATE POLICY "case_documents_delete_own"
  ON public.case_documents FOR DELETE
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.professional_cases pc
      WHERE pc.id = case_id AND pc.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_id AND d.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "atom_evidence_links_select_own" ON public.atom_evidence_links;
DROP POLICY IF EXISTS "atom_evidence_links_insert_own" ON public.atom_evidence_links;
DROP POLICY IF EXISTS "atom_evidence_links_update_own" ON public.atom_evidence_links;
DROP POLICY IF EXISTS "atom_evidence_links_delete_own" ON public.atom_evidence_links;

CREATE POLICY "atom_evidence_links_select_own"
  ON public.atom_evidence_links FOR SELECT
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.cv_evidence_atoms a
      WHERE a.id = atom_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY "atom_evidence_links_insert_own"
  ON public.atom_evidence_links FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.cv_evidence_atoms a
      WHERE a.id = atom_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY "atom_evidence_links_update_own"
  ON public.atom_evidence_links FOR UPDATE
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.cv_evidence_atoms a
      WHERE a.id = atom_id AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.cv_evidence_atoms a
      WHERE a.id = atom_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY "atom_evidence_links_delete_own"
  ON public.atom_evidence_links FOR DELETE
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.cv_evidence_atoms a
      WHERE a.id = atom_id AND a.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 6. updated_at triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS min_dok_documents_updated_at ON public.documents;
CREATE TRIGGER min_dok_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS min_dok_professional_cases_updated_at ON public.professional_cases;
CREATE TRIGGER min_dok_professional_cases_updated_at
  BEFORE UPDATE ON public.professional_cases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS min_dok_professional_results_updated_at ON public.professional_results;
CREATE TRIGGER min_dok_professional_results_updated_at
  BEFORE UPDATE ON public.professional_results
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS min_dok_atom_evidence_links_updated_at ON public.atom_evidence_links;
CREATE TRIGGER min_dok_atom_evidence_links_updated_at
  BEFORE UPDATE ON public.atom_evidence_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 7. career_atoms view (alias over cv_evidence_atoms; table not renamed)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.career_atoms
WITH (security_invoker = true) AS
SELECT
  id,
  user_id,
  atom_type,
  parent_atom_id,
  content_no,
  content_en,
  structured_data,
  source_type,
  source_ref,
  source_quote,
  confidence,
  user_confirmed,
  user_locked,
  dedupe_key,
  canonical_atom_id,
  evidence_scope,
  career_stage_relevance,
  role_relevance_tags,
  relevance_score,
  last_seen_at,
  created_at,
  updated_at
FROM public.cv_evidence_atoms;
