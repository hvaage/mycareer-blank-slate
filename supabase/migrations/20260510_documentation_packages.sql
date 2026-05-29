-- Min dokumentasjon – documentation packages (non-destructive)
-- Creates documentation_packages and documentation_package_items with indexes,
-- RLS, and updated_at triggers. Depends on public.update_updated_at_column(),
-- public.applications, public.job_leads, and auth.users.

-- ---------------------------------------------------------------------------
-- 1. documentation_packages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.documentation_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  package_type text NOT NULL DEFAULT 'job_application',
  target_role text,
  target_company text,
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  job_lead_id uuid REFERENCES public.job_leads(id) ON DELETE SET NULL,
  visibility text NOT NULL DEFAULT 'private',
  status text NOT NULL DEFAULT 'draft',
  share_token text UNIQUE,
  expires_at timestamptz,
  last_shared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documentation_packages_package_type_check
    CHECK (package_type IN (
      'job_application',
      'executive_profile',
      'board_profile',
      'portfolio',
      'recruiter_share'
    ))
);

-- ---------------------------------------------------------------------------
-- 2. documentation_package_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.documentation_package_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.documentation_packages(id) ON DELETE CASCADE,
  item_type text NOT NULL,
  item_id uuid NOT NULL,
  title_override text,
  notes text,
  display_order integer DEFAULT 0,
  included boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documentation_package_items_item_type_check
    CHECK (item_type IN (
      'document',
      'case',
      'result',
      'reference',
      'recommendation',
      'cv_document',
      'cover_letter',
      'portfolio_item'
    )),
  UNIQUE (package_id, item_type, item_id)
);

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_documentation_packages_user_updated
  ON public.documentation_packages (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_documentation_packages_user_status
  ON public.documentation_packages (user_id, status);

CREATE INDEX IF NOT EXISTS idx_documentation_packages_application_id
  ON public.documentation_packages (application_id)
  WHERE application_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documentation_packages_job_lead_id
  ON public.documentation_packages (job_lead_id)
  WHERE job_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documentation_package_items_package_id
  ON public.documentation_package_items (package_id);

CREATE INDEX IF NOT EXISTS idx_documentation_package_items_user_id
  ON public.documentation_package_items (user_id);

CREATE INDEX IF NOT EXISTS idx_documentation_package_items_package_display_order
  ON public.documentation_package_items (package_id, display_order);

-- ---------------------------------------------------------------------------
-- 4. Row level security
-- ---------------------------------------------------------------------------
ALTER TABLE public.documentation_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentation_package_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "documentation_packages_select_own" ON public.documentation_packages;
DROP POLICY IF EXISTS "documentation_packages_insert_own" ON public.documentation_packages;
DROP POLICY IF EXISTS "documentation_packages_update_own" ON public.documentation_packages;
DROP POLICY IF EXISTS "documentation_packages_delete_own" ON public.documentation_packages;

CREATE POLICY "documentation_packages_select_own"
  ON public.documentation_packages FOR SELECT
  USING (
    auth.uid() = user_id
    AND (
      application_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.id = application_id AND a.user_id = auth.uid()
      )
    )
    AND (
      job_lead_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.job_leads jl
        WHERE jl.id = job_lead_id AND jl.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "documentation_packages_insert_own"
  ON public.documentation_packages FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND (
      application_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.id = application_id AND a.user_id = auth.uid()
      )
    )
    AND (
      job_lead_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.job_leads jl
        WHERE jl.id = job_lead_id AND jl.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "documentation_packages_update_own"
  ON public.documentation_packages FOR UPDATE
  USING (
    auth.uid() = user_id
    AND (
      application_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.id = application_id AND a.user_id = auth.uid()
      )
    )
    AND (
      job_lead_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.job_leads jl
        WHERE jl.id = job_lead_id AND jl.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND (
      application_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.id = application_id AND a.user_id = auth.uid()
      )
    )
    AND (
      job_lead_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.job_leads jl
        WHERE jl.id = job_lead_id AND jl.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "documentation_packages_delete_own"
  ON public.documentation_packages FOR DELETE
  USING (
    auth.uid() = user_id
    AND (
      application_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.id = application_id AND a.user_id = auth.uid()
      )
    )
    AND (
      job_lead_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.job_leads jl
        WHERE jl.id = job_lead_id AND jl.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "documentation_package_items_select_own" ON public.documentation_package_items;
DROP POLICY IF EXISTS "documentation_package_items_insert_own" ON public.documentation_package_items;
DROP POLICY IF EXISTS "documentation_package_items_update_own" ON public.documentation_package_items;
DROP POLICY IF EXISTS "documentation_package_items_delete_own" ON public.documentation_package_items;

CREATE POLICY "documentation_package_items_select_own"
  ON public.documentation_package_items FOR SELECT
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.documentation_packages p
      WHERE p.id = package_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "documentation_package_items_insert_own"
  ON public.documentation_package_items FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.documentation_packages p
      WHERE p.id = package_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "documentation_package_items_update_own"
  ON public.documentation_package_items FOR UPDATE
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.documentation_packages p
      WHERE p.id = package_id AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.documentation_packages p
      WHERE p.id = package_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "documentation_package_items_delete_own"
  ON public.documentation_package_items FOR DELETE
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.documentation_packages p
      WHERE p.id = package_id AND p.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 5. updated_at triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS min_dok_documentation_packages_updated_at ON public.documentation_packages;
CREATE TRIGGER min_dok_documentation_packages_updated_at
  BEFORE UPDATE ON public.documentation_packages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS min_dok_documentation_package_items_updated_at ON public.documentation_package_items;
CREATE TRIGGER min_dok_documentation_package_items_updated_at
  BEFORE UPDATE ON public.documentation_package_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
