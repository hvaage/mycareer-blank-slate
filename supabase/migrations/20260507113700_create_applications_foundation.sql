-- Foundation for public.applications (must run before ALTER TABLE public.applications migrations).
-- Root cause: migrations altered applications but no migration created the table.
-- public.job_applications remains separate (legacy); no FK between them unless added later.

DO $$ BEGIN
  CREATE TYPE public.priority_level AS ENUM ('høy', 'middels', 'lav');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  role_title text,
  status public.application_status NOT NULL DEFAULT 'identifisert',
  priority public.priority_level DEFAULT 'middels',
  job_url text,
  location text,
  work_type text,
  source text,
  notes text,
  applied_date date,
  industry text,
  company_size text,
  company_website text,
  company_linkedin text,
  recruiter_name text,
  recruiter_email text,
  contact_name text,
  contact_email text,
  contact_linkedin text,
  salary_currency text,
  salary_range_min numeric,
  salary_range_max numeric,
  available_from date,
  internal_assessment text,
  is_starred boolean DEFAULT false,
  rating numeric,
  role_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applications_user_id ON public.applications(user_id);

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own applications" ON public.applications;
DROP POLICY IF EXISTS "Users can insert own applications" ON public.applications;
DROP POLICY IF EXISTS "Users can update own applications" ON public.applications;
DROP POLICY IF EXISTS "Users can delete own applications" ON public.applications;

CREATE POLICY "Users can view own applications"
  ON public.applications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own applications"
  ON public.applications FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own applications"
  ON public.applications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own applications"
  ON public.applications FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS applications_updated_at ON public.applications;
CREATE TRIGGER applications_updated_at
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
