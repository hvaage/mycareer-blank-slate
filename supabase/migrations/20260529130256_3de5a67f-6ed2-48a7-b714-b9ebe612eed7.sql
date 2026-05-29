-- Chunk A: applications foundation through user_company_ratings
-- 20260507113700
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
  job_url text, location text, work_type text, source text, notes text, applied_date date,
  industry text, company_size text, company_website text, company_linkedin text,
  recruiter_name text, recruiter_email text, contact_name text, contact_email text, contact_linkedin text,
  salary_currency text, salary_range_min numeric, salary_range_max numeric,
  available_from date, internal_assessment text, is_starred boolean DEFAULT false,
  rating numeric, role_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.applications TO authenticated;
GRANT ALL ON public.applications TO service_role;
CREATE INDEX IF NOT EXISTS idx_applications_user_id ON public.applications(user_id);
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own applications" ON public.applications;
DROP POLICY IF EXISTS "Users can insert own applications" ON public.applications;
DROP POLICY IF EXISTS "Users can update own applications" ON public.applications;
DROP POLICY IF EXISTS "Users can delete own applications" ON public.applications;
CREATE POLICY "Users can view own applications" ON public.applications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own applications" ON public.applications FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own applications" ON public.applications FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own applications" ON public.applications FOR DELETE TO authenticated USING (auth.uid() = user_id);
DROP TRIGGER IF EXISTS applications_updated_at ON public.applications;
CREATE TRIGGER applications_updated_at BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 20260507113750
CREATE TABLE IF NOT EXISTS public.job_ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  raw_text text, source_url text, application_deadline date,
  must_have_keywords text[], nice_to_have text[], key_requirements text[],
  parsed_company text, parsed_role text, parsed_location text, parsed_work_type text,
  fit_analysis text, salary_info text, imported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_ads TO authenticated;
GRANT ALL ON public.job_ads TO service_role;
CREATE INDEX IF NOT EXISTS idx_job_ads_application_id ON public.job_ads(application_id);
ALTER TABLE public.job_ads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "job_ads_select_own" ON public.job_ads;
DROP POLICY IF EXISTS "job_ads_insert_own" ON public.job_ads;
DROP POLICY IF EXISTS "job_ads_update_own" ON public.job_ads;
DROP POLICY IF EXISTS "job_ads_delete_own" ON public.job_ads;
CREATE POLICY "job_ads_select_own" ON public.job_ads FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.applications a WHERE a.id = job_ads.application_id AND a.user_id = auth.uid()));
CREATE POLICY "job_ads_insert_own" ON public.job_ads FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.applications a WHERE a.id = job_ads.application_id AND a.user_id = auth.uid()));
CREATE POLICY "job_ads_update_own" ON public.job_ads FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.applications a WHERE a.id = job_ads.application_id AND a.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.applications a WHERE a.id = job_ads.application_id AND a.user_id = auth.uid()));
CREATE POLICY "job_ads_delete_own" ON public.job_ads FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.applications a WHERE a.id = job_ads.application_id AND a.user_id = auth.uid()));
DROP TRIGGER IF EXISTS job_ads_updated_at ON public.job_ads;
CREATE TRIGGER job_ads_updated_at BEFORE UPDATE ON public.job_ads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 20260507113809
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS contact_phone text, ADD COLUMN IF NOT EXISTS recruiter_phone text;
ALTER TABLE public.job_ads ADD COLUMN IF NOT EXISTS about_role text, ADD COLUMN IF NOT EXISTS about_company text, ADD COLUMN IF NOT EXISTS ideal_candidate text;

-- 20260507115031
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cv_no_word_path text, ADD COLUMN IF NOT EXISTS cv_no_pdf_path text,
  ADD COLUMN IF NOT EXISTS cv_no_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS cv_en_word_path text, ADD COLUMN IF NOT EXISTS cv_en_pdf_path text,
  ADD COLUMN IF NOT EXISTS cv_en_updated_at timestamptz;

-- 20260507134300
CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
CREATE INDEX IF NOT EXISTS idx_companies_name_lower ON public.companies (lower(name));
DROP TRIGGER IF EXISTS companies_updated_at ON public.companies;
CREATE TRIGGER companies_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 20260507134310
CREATE TABLE IF NOT EXISTS public.user_company_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  culture_score numeric(4,1), leadership_score numeric(4,1), work_environment_score numeric(4,1),
  career_development_score numeric(4,1), financial_stability_score numeric(4,1), mission_score numeric(4,1),
  overall_score numeric(4,1),
  applied_here boolean DEFAULT false, interviewed_here boolean DEFAULT false, worked_here boolean DEFAULT false,
  user_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_company_ratings_user_company_unique UNIQUE (user_id, company_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_company_ratings TO authenticated;
GRANT ALL ON public.user_company_ratings TO service_role;
CREATE INDEX IF NOT EXISTS idx_user_company_ratings_user ON public.user_company_ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_company_ratings_company ON public.user_company_ratings(company_id);
ALTER TABLE public.user_company_ratings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own company ratings" ON public.user_company_ratings;
DROP POLICY IF EXISTS "Users insert own company ratings" ON public.user_company_ratings;
DROP POLICY IF EXISTS "Users update own company ratings" ON public.user_company_ratings;
DROP POLICY IF EXISTS "Users delete own company ratings" ON public.user_company_ratings;
CREATE POLICY "Users own company ratings" ON public.user_company_ratings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own company ratings" ON public.user_company_ratings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own company ratings" ON public.user_company_ratings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own company ratings" ON public.user_company_ratings FOR DELETE TO authenticated USING (auth.uid() = user_id);
DROP TRIGGER IF EXISTS user_company_ratings_updated_at ON public.user_company_ratings;
CREATE TRIGGER user_company_ratings_updated_at BEFORE UPDATE ON public.user_company_ratings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 20260507134325
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read companies" ON public.companies;
CREATE POLICY "Authenticated users can read companies" ON public.companies FOR SELECT USING (auth.role() = 'authenticated');
ALTER TABLE public.user_company_ratings ADD COLUMN IF NOT EXISTS ai_candidate_fit_score numeric(3,1);
ALTER TABLE public.companies DROP COLUMN IF EXISTS ai_candidate_fit_score;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
CREATE INDEX IF NOT EXISTS idx_applications_company_id ON public.applications(company_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_company_ratings_user_company_unique') THEN
    ALTER TABLE public.user_company_ratings ADD CONSTRAINT user_company_ratings_user_company_unique UNIQUE (user_id, company_id);
  END IF;
END $$;