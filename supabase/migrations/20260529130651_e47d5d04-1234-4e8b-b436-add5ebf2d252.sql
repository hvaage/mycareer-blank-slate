ALTER TABLE public.user_company_ratings ADD COLUMN IF NOT EXISTS ai_candidate_fit_reasoning text;
ALTER TABLE public.user_job_listing_status
  ADD COLUMN IF NOT EXISTS ai_score smallint,
  ADD COLUMN IF NOT EXISTS ai_reasoning text,
  ADD COLUMN IF NOT EXISTS ai_match_highlights text,
  ADD COLUMN IF NOT EXISTS ai_concerns text,
  ADD COLUMN IF NOT EXISTS ai_scored_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS lead_dedupe_keys_user_key_uniq ON public.lead_dedupe_keys(user_id, dedupe_key);

CREATE OR REPLACE FUNCTION public.prune_stale_leads(p_user_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.job_leads WHERE user_id = p_user_id AND promoted_application_id IS NULL
    AND status IN ('ny','avvist','arkivert') AND created_at < now() - interval '30 days';
  DELETE FROM public.user_job_listing_status WHERE user_id = p_user_id
    AND status IN ('new','dismissed') AND updated_at < now() - interval '30 days';
  WITH ranked AS (
    SELECT id, row_number() OVER (
      PARTITION BY user_id, public.normalize_lead_key(coalesce(job_url,''), coalesce(company,''), coalesce(title,''), coalesce(location,''))
      ORDER BY (promoted_application_id IS NOT NULL) DESC, created_at ASC
    ) AS rn FROM public.job_leads WHERE user_id = p_user_id
  ) DELETE FROM public.job_leads jl USING ranked r WHERE jl.id = r.id AND r.rn > 1;
  DELETE FROM public.lead_dedupe_keys WHERE user_id = p_user_id AND status = 'active'
    AND updated_at < now() - interval '30 days'
    AND NOT EXISTS (SELECT 1 FROM public.job_leads jl WHERE jl.user_id = p_user_id AND lead_dedupe_keys.ref_table = 'job_leads' AND jl.id = lead_dedupe_keys.ref_id)
    AND NOT EXISTS (SELECT 1 FROM public.user_job_listing_status us WHERE us.user_id = p_user_id AND lead_dedupe_keys.ref_table = 'user_job_listing_status' AND us.id = lead_dedupe_keys.ref_id)
    AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.user_id = p_user_id AND lead_dedupe_keys.ref_table = 'applications' AND a.id = lead_dedupe_keys.ref_id);
END; $function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE IF NOT EXISTS public.cv_evidence_atoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  atom_type text NOT NULL CHECK (atom_type IN ('role','achievement','metric','context','tool','education','skill','language','certification','project','volunteer','summary_fragment')),
  parent_atom_id uuid REFERENCES public.cv_evidence_atoms(id) ON DELETE CASCADE,
  content_no text, content_en text, structured_data jsonb,
  source_type text NOT NULL CHECK (source_type IN ('linkedin_oauth','linkedin_zip','linkedin_pdf','old_cv_pdf','old_cv_docx','interview','manual','about_me_profile','onboarding')),
  source_ref text, source_quote text,
  confidence text NOT NULL DEFAULT 'imported' CHECK (confidence IN ('verified','imported','inferred')),
  user_confirmed boolean NOT NULL DEFAULT false,
  user_locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cv_evidence_atoms TO authenticated;
GRANT ALL ON public.cv_evidence_atoms TO service_role;

CREATE TABLE IF NOT EXISTS public.cv_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_type text NOT NULL CHECK (import_type IN ('linkedin_zip','linkedin_pdf','old_cv_pdf','old_cv_docx','manual')),
  source_filename text, source_file_path text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','parsed','reviewed','committed','failed')),
  raw_parsed_data jsonb,
  atoms_created_count integer NOT NULL DEFAULT 0,
  atoms_committed_count integer NOT NULL DEFAULT 0,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  parsed_at timestamptz, committed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cv_imports TO authenticated;
GRANT ALL ON public.cv_imports TO service_role;

CREATE TABLE IF NOT EXISTS public.cv_consent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_type text NOT NULL CHECK (consent_type IN ('birth_year','profile_photo','nationality','marital_status','address','data_processing')),
  consent_given boolean NOT NULL DEFAULT false,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz, context text, ip_address text, user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cv_consent_log TO authenticated;
GRANT ALL ON public.cv_consent_log TO service_role;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS atom_ids uuid[],
  ADD COLUMN IF NOT EXISTS atom_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS render_template_version text,
  ADD COLUMN IF NOT EXISTS ats_rules_version text,
  ADD COLUMN IF NOT EXISTS guard_version text,
  ADD COLUMN IF NOT EXISTS guard_result jsonb,
  ADD COLUMN IF NOT EXISTS quality_result jsonb,
  ADD COLUMN IF NOT EXISTS render_language text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_render_language_check') THEN
    ALTER TABLE public.documents ADD CONSTRAINT documents_render_language_check CHECK (render_language IS NULL OR render_language IN ('no','en'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cv_atoms_user_id ON public.cv_evidence_atoms(user_id);
CREATE INDEX IF NOT EXISTS idx_cv_atoms_user_type ON public.cv_evidence_atoms(user_id, atom_type);
CREATE INDEX IF NOT EXISTS idx_cv_atoms_user_confirmed ON public.cv_evidence_atoms(user_id, user_confirmed);
CREATE INDEX IF NOT EXISTS idx_cv_atoms_parent ON public.cv_evidence_atoms(parent_atom_id) WHERE parent_atom_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cv_atoms_source ON public.cv_evidence_atoms(user_id, source_type, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cv_imports_user_status ON public.cv_imports(user_id, status);
CREATE INDEX IF NOT EXISTS idx_cv_imports_user_started ON public.cv_imports(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cv_consent_user_type ON public.cv_consent_log(user_id, consent_type, granted_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_atom_ids ON public.documents USING GIN(atom_ids) WHERE atom_ids IS NOT NULL;

ALTER TABLE public.cv_evidence_atoms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cv_atoms_select_own" ON public.cv_evidence_atoms;
DROP POLICY IF EXISTS "cv_atoms_insert_own" ON public.cv_evidence_atoms;
DROP POLICY IF EXISTS "cv_atoms_update_own" ON public.cv_evidence_atoms;
DROP POLICY IF EXISTS "cv_atoms_delete_own" ON public.cv_evidence_atoms;
CREATE POLICY "cv_atoms_select_own" ON public.cv_evidence_atoms FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "cv_atoms_insert_own" ON public.cv_evidence_atoms FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cv_atoms_update_own" ON public.cv_evidence_atoms FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cv_atoms_delete_own" ON public.cv_evidence_atoms FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.cv_imports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cv_imports_select_own" ON public.cv_imports;
DROP POLICY IF EXISTS "cv_imports_insert_own" ON public.cv_imports;
DROP POLICY IF EXISTS "cv_imports_update_own" ON public.cv_imports;
DROP POLICY IF EXISTS "cv_imports_delete_own" ON public.cv_imports;
CREATE POLICY "cv_imports_select_own" ON public.cv_imports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "cv_imports_insert_own" ON public.cv_imports FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cv_imports_update_own" ON public.cv_imports FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cv_imports_delete_own" ON public.cv_imports FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.cv_consent_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cv_consent_select_own" ON public.cv_consent_log;
DROP POLICY IF EXISTS "cv_consent_insert_own" ON public.cv_consent_log;
CREATE POLICY "cv_consent_select_own" ON public.cv_consent_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "cv_consent_insert_own" ON public.cv_consent_log FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS set_cv_evidence_atoms_updated_at ON public.cv_evidence_atoms;
CREATE TRIGGER set_cv_evidence_atoms_updated_at BEFORE UPDATE ON public.cv_evidence_atoms FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS set_cv_imports_updated_at ON public.cv_imports;
CREATE TRIGGER set_cv_imports_updated_at BEFORE UPDATE ON public.cv_imports FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS set_cv_consent_log_updated_at ON public.cv_consent_log;
CREATE TRIGGER set_cv_consent_log_updated_at BEFORE UPDATE ON public.cv_consent_log FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260509_min_dokumentasjon_foundation
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

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.documents'::regclass AND c.conname = 'documents_documentation_status_check') THEN
  ALTER TABLE public.documents ADD CONSTRAINT documents_documentation_status_check CHECK (documentation_status IN ('active', 'archived', 'deleted'));
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.documents'::regclass AND c.conname = 'documents_visibility_check') THEN
  ALTER TABLE public.documents ADD CONSTRAINT documents_visibility_check CHECK (visibility IN ('private', 'shared', 'public', 'restricted'));
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.documents'::regclass AND c.conname = 'documents_confidentiality_level_check') THEN
  ALTER TABLE public.documents ADD CONSTRAINT documents_confidentiality_level_check CHECK (confidentiality_level IN ('normal', 'sensitive', 'confidential'));
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.documents'::regclass AND c.conname = 'documents_embedding_status_check') THEN
  ALTER TABLE public.documents ADD CONSTRAINT documents_embedding_status_check CHECK (embedding_status IN ('not_started', 'queued', 'processing', 'completed', 'failed'));
END IF; END $$;

ALTER TABLE public.cv_evidence_atoms
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS canonical_atom_id uuid REFERENCES public.cv_evidence_atoms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS evidence_scope text DEFAULT 'cv',
  ADD COLUMN IF NOT EXISTS career_stage_relevance text[],
  ADD COLUMN IF NOT EXISTS role_relevance_tags text[],
  ADD COLUMN IF NOT EXISTS relevance_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz DEFAULT now();

CREATE TABLE IF NOT EXISTS public.professional_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL, summary text, situation text, responsibility text, actions_taken text, results text,
  company_name text, industry text, role_context text, time_period text,
  visibility text NOT NULL DEFAULT 'private', status text NOT NULL DEFAULT 'draft',
  career_stage_relevance text[], role_relevance_tags text[],
  atom_ids uuid[], ai_summary text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.professional_cases TO authenticated;
GRANT ALL ON public.professional_cases TO service_role;

CREATE TABLE IF NOT EXISTS public.professional_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL, description text, metric_name text, metric_value text, metric_unit text,
  baseline_value text, final_value text, time_period text, company_name text, role_context text,
  verified boolean NOT NULL DEFAULT false, visibility text NOT NULL DEFAULT 'private',
  atom_ids uuid[], evidence_strength numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.professional_results TO authenticated;
GRANT ALL ON public.professional_results TO service_role;

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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_documents TO authenticated;
GRANT ALL ON public.case_documents TO service_role;

CREATE TABLE IF NOT EXISTS public.atom_evidence_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  atom_id uuid NOT NULL REFERENCES public.cv_evidence_atoms(id) ON DELETE CASCADE,
  evidence_type text NOT NULL, evidence_id uuid NOT NULL, evidence_label text,
  strength_score numeric DEFAULT 0,
  ai_generated boolean NOT NULL DEFAULT false,
  manually_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (atom_id, evidence_type, evidence_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.atom_evidence_links TO authenticated;
GRANT ALL ON public.atom_evidence_links TO service_role;

CREATE INDEX IF NOT EXISTS idx_documents_user_category ON public.documents (user_id, documentation_category);
CREATE INDEX IF NOT EXISTS idx_documents_user_status ON public.documents (user_id, documentation_status);
CREATE INDEX IF NOT EXISTS idx_documents_role_tags ON public.documents USING gin (role_relevance_tags);
CREATE INDEX IF NOT EXISTS idx_documents_career_stage ON public.documents USING gin (career_stage_relevance);
CREATE INDEX IF NOT EXISTS idx_cv_evidence_atoms_dedupe_key ON public.cv_evidence_atoms (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cv_evidence_atoms_canonical_atom_id ON public.cv_evidence_atoms (canonical_atom_id) WHERE canonical_atom_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_atom_evidence_links_atom ON public.atom_evidence_links (atom_id);
CREATE INDEX IF NOT EXISTS idx_atom_evidence_links_user_type ON public.atom_evidence_links (user_id, evidence_type);
CREATE INDEX IF NOT EXISTS idx_professional_cases_user ON public.professional_cases (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_professional_results_user ON public.professional_results (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_documents_case ON public.case_documents (case_id);
CREATE INDEX IF NOT EXISTS idx_case_documents_document ON public.case_documents (document_id);
CREATE INDEX IF NOT EXISTS idx_case_documents_user ON public.case_documents (user_id);

ALTER TABLE public.professional_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atom_evidence_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "professional_cases_select_own" ON public.professional_cases;
DROP POLICY IF EXISTS "professional_cases_insert_own" ON public.professional_cases;
DROP POLICY IF EXISTS "professional_cases_update_own" ON public.professional_cases;
DROP POLICY IF EXISTS "professional_cases_delete_own" ON public.professional_cases;
CREATE POLICY "professional_cases_select_own" ON public.professional_cases FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "professional_cases_insert_own" ON public.professional_cases FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "professional_cases_update_own" ON public.professional_cases FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "professional_cases_delete_own" ON public.professional_cases FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "professional_results_select_own" ON public.professional_results;
DROP POLICY IF EXISTS "professional_results_insert_own" ON public.professional_results;
DROP POLICY IF EXISTS "professional_results_update_own" ON public.professional_results;
DROP POLICY IF EXISTS "professional_results_delete_own" ON public.professional_results;
CREATE POLICY "professional_results_select_own" ON public.professional_results FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "professional_results_insert_own" ON public.professional_results FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "professional_results_update_own" ON public.professional_results FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "professional_results_delete_own" ON public.professional_results FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "case_documents_select_own" ON public.case_documents;
DROP POLICY IF EXISTS "case_documents_insert_own" ON public.case_documents;
DROP POLICY IF EXISTS "case_documents_update_own" ON public.case_documents;
DROP POLICY IF EXISTS "case_documents_delete_own" ON public.case_documents;
CREATE POLICY "case_documents_select_own" ON public.case_documents FOR SELECT USING (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.professional_cases pc WHERE pc.id = case_id AND pc.user_id = auth.uid())
  AND EXISTS (SELECT 1 FROM public.documents d WHERE d.id = document_id AND d.user_id = auth.uid()));
CREATE POLICY "case_documents_insert_own" ON public.case_documents FOR INSERT WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.professional_cases pc WHERE pc.id = case_id AND pc.user_id = auth.uid())
  AND EXISTS (SELECT 1 FROM public.documents d WHERE d.id = document_id AND d.user_id = auth.uid()));
CREATE POLICY "case_documents_update_own" ON public.case_documents FOR UPDATE USING (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.professional_cases pc WHERE pc.id = case_id AND pc.user_id = auth.uid())
  AND EXISTS (SELECT 1 FROM public.documents d WHERE d.id = document_id AND d.user_id = auth.uid()))
  WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.professional_cases pc WHERE pc.id = case_id AND pc.user_id = auth.uid())
  AND EXISTS (SELECT 1 FROM public.documents d WHERE d.id = document_id AND d.user_id = auth.uid()));
CREATE POLICY "case_documents_delete_own" ON public.case_documents FOR DELETE USING (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.professional_cases pc WHERE pc.id = case_id AND pc.user_id = auth.uid())
  AND EXISTS (SELECT 1 FROM public.documents d WHERE d.id = document_id AND d.user_id = auth.uid()));

DROP POLICY IF EXISTS "atom_evidence_links_select_own" ON public.atom_evidence_links;
DROP POLICY IF EXISTS "atom_evidence_links_insert_own" ON public.atom_evidence_links;
DROP POLICY IF EXISTS "atom_evidence_links_update_own" ON public.atom_evidence_links;
DROP POLICY IF EXISTS "atom_evidence_links_delete_own" ON public.atom_evidence_links;
CREATE POLICY "atom_evidence_links_select_own" ON public.atom_evidence_links FOR SELECT USING (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.cv_evidence_atoms a WHERE a.id = atom_id AND a.user_id = auth.uid()));
CREATE POLICY "atom_evidence_links_insert_own" ON public.atom_evidence_links FOR INSERT WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.cv_evidence_atoms a WHERE a.id = atom_id AND a.user_id = auth.uid()));
CREATE POLICY "atom_evidence_links_update_own" ON public.atom_evidence_links FOR UPDATE USING (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.cv_evidence_atoms a WHERE a.id = atom_id AND a.user_id = auth.uid())) WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.cv_evidence_atoms a WHERE a.id = atom_id AND a.user_id = auth.uid()));
CREATE POLICY "atom_evidence_links_delete_own" ON public.atom_evidence_links FOR DELETE USING (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.cv_evidence_atoms a WHERE a.id = atom_id AND a.user_id = auth.uid()));

DROP TRIGGER IF EXISTS min_dok_documents_updated_at ON public.documents;
CREATE TRIGGER min_dok_documents_updated_at BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS min_dok_professional_cases_updated_at ON public.professional_cases;
CREATE TRIGGER min_dok_professional_cases_updated_at BEFORE UPDATE ON public.professional_cases FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS min_dok_professional_results_updated_at ON public.professional_results;
CREATE TRIGGER min_dok_professional_results_updated_at BEFORE UPDATE ON public.professional_results FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS min_dok_atom_evidence_links_updated_at ON public.atom_evidence_links;
CREATE TRIGGER min_dok_atom_evidence_links_updated_at BEFORE UPDATE ON public.atom_evidence_links FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE VIEW public.career_atoms WITH (security_invoker = true) AS
SELECT id, user_id, atom_type, parent_atom_id, content_no, content_en, structured_data,
  source_type, source_ref, source_quote, confidence, user_confirmed, user_locked,
  dedupe_key, canonical_atom_id, evidence_scope, career_stage_relevance, role_relevance_tags,
  relevance_score, last_seen_at, created_at, updated_at
FROM public.cv_evidence_atoms;
GRANT SELECT ON public.career_atoms TO authenticated;

-- 20260510_documentation_packages
CREATE TABLE IF NOT EXISTS public.documentation_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL, description text,
  package_type text NOT NULL DEFAULT 'job_application',
  target_role text, target_company text,
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  job_lead_id uuid REFERENCES public.job_leads(id) ON DELETE SET NULL,
  visibility text NOT NULL DEFAULT 'private',
  status text NOT NULL DEFAULT 'draft',
  share_token text UNIQUE, expires_at timestamptz, last_shared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documentation_packages_package_type_check CHECK (package_type IN ('job_application','executive_profile','board_profile','portfolio','recruiter_share'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documentation_packages TO authenticated;
GRANT ALL ON public.documentation_packages TO service_role;

CREATE TABLE IF NOT EXISTS public.documentation_package_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.documentation_packages(id) ON DELETE CASCADE,
  item_type text NOT NULL, item_id uuid NOT NULL,
  title_override text, notes text,
  display_order integer DEFAULT 0,
  included boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documentation_package_items_item_type_check CHECK (item_type IN ('document','case','result','reference','recommendation','cv_document','cover_letter','portfolio_item')),
  UNIQUE (package_id, item_type, item_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documentation_package_items TO authenticated;
GRANT ALL ON public.documentation_package_items TO service_role;

CREATE INDEX IF NOT EXISTS idx_documentation_packages_user_updated ON public.documentation_packages (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documentation_packages_user_status ON public.documentation_packages (user_id, status);
CREATE INDEX IF NOT EXISTS idx_documentation_packages_application_id ON public.documentation_packages (application_id) WHERE application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documentation_packages_job_lead_id ON public.documentation_packages (job_lead_id) WHERE job_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documentation_package_items_package_id ON public.documentation_package_items (package_id);
CREATE INDEX IF NOT EXISTS idx_documentation_package_items_user_id ON public.documentation_package_items (user_id);
CREATE INDEX IF NOT EXISTS idx_documentation_package_items_package_display_order ON public.documentation_package_items (package_id, display_order);

ALTER TABLE public.documentation_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentation_package_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "documentation_packages_select_own" ON public.documentation_packages;
DROP POLICY IF EXISTS "documentation_packages_insert_own" ON public.documentation_packages;
DROP POLICY IF EXISTS "documentation_packages_update_own" ON public.documentation_packages;
DROP POLICY IF EXISTS "documentation_packages_delete_own" ON public.documentation_packages;
CREATE POLICY "documentation_packages_select_own" ON public.documentation_packages FOR SELECT USING (
  auth.uid() = user_id
  AND (application_id IS NULL OR EXISTS (SELECT 1 FROM public.applications a WHERE a.id = application_id AND a.user_id = auth.uid()))
  AND (job_lead_id IS NULL OR EXISTS (SELECT 1 FROM public.job_leads jl WHERE jl.id = job_lead_id AND jl.user_id = auth.uid())));
CREATE POLICY "documentation_packages_insert_own" ON public.documentation_packages FOR INSERT WITH CHECK (
  auth.uid() = user_id
  AND (application_id IS NULL OR EXISTS (SELECT 1 FROM public.applications a WHERE a.id = application_id AND a.user_id = auth.uid()))
  AND (job_lead_id IS NULL OR EXISTS (SELECT 1 FROM public.job_leads jl WHERE jl.id = job_lead_id AND jl.user_id = auth.uid())));
CREATE POLICY "documentation_packages_update_own" ON public.documentation_packages FOR UPDATE USING (
  auth.uid() = user_id
  AND (application_id IS NULL OR EXISTS (SELECT 1 FROM public.applications a WHERE a.id = application_id AND a.user_id = auth.uid()))
  AND (job_lead_id IS NULL OR EXISTS (SELECT 1 FROM public.job_leads jl WHERE jl.id = job_lead_id AND jl.user_id = auth.uid())))
  WITH CHECK (
  auth.uid() = user_id
  AND (application_id IS NULL OR EXISTS (SELECT 1 FROM public.applications a WHERE a.id = application_id AND a.user_id = auth.uid()))
  AND (job_lead_id IS NULL OR EXISTS (SELECT 1 FROM public.job_leads jl WHERE jl.id = job_lead_id AND jl.user_id = auth.uid())));
CREATE POLICY "documentation_packages_delete_own" ON public.documentation_packages FOR DELETE USING (
  auth.uid() = user_id
  AND (application_id IS NULL OR EXISTS (SELECT 1 FROM public.applications a WHERE a.id = application_id AND a.user_id = auth.uid()))
  AND (job_lead_id IS NULL OR EXISTS (SELECT 1 FROM public.job_leads jl WHERE jl.id = job_lead_id AND jl.user_id = auth.uid())));

DROP POLICY IF EXISTS "documentation_package_items_select_own" ON public.documentation_package_items;
DROP POLICY IF EXISTS "documentation_package_items_insert_own" ON public.documentation_package_items;
DROP POLICY IF EXISTS "documentation_package_items_update_own" ON public.documentation_package_items;
DROP POLICY IF EXISTS "documentation_package_items_delete_own" ON public.documentation_package_items;
CREATE POLICY "documentation_package_items_select_own" ON public.documentation_package_items FOR SELECT USING (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.documentation_packages p WHERE p.id = package_id AND p.user_id = auth.uid()));
CREATE POLICY "documentation_package_items_insert_own" ON public.documentation_package_items FOR INSERT WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.documentation_packages p WHERE p.id = package_id AND p.user_id = auth.uid()));
CREATE POLICY "documentation_package_items_update_own" ON public.documentation_package_items FOR UPDATE USING (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.documentation_packages p WHERE p.id = package_id AND p.user_id = auth.uid())) WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.documentation_packages p WHERE p.id = package_id AND p.user_id = auth.uid()));
CREATE POLICY "documentation_package_items_delete_own" ON public.documentation_package_items FOR DELETE USING (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.documentation_packages p WHERE p.id = package_id AND p.user_id = auth.uid()));

DROP TRIGGER IF EXISTS min_dok_documentation_packages_updated_at ON public.documentation_packages;
CREATE TRIGGER min_dok_documentation_packages_updated_at BEFORE UPDATE ON public.documentation_packages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS min_dok_documentation_package_items_updated_at ON public.documentation_package_items;
CREATE TRIGGER min_dok_documentation_package_items_updated_at BEFORE UPDATE ON public.documentation_package_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();