-- Foundation for public.job_ads (must run before 20260507113809 alters it).
-- Root cause: no migration created job_ads; only ALTER ... ADD about_* exists.
-- Depends on: public.applications (20260507113700), public.set_updated_at().

CREATE TABLE IF NOT EXISTS public.job_ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  raw_text text,
  source_url text,
  application_deadline date,
  must_have_keywords text[],
  nice_to_have text[],
  key_requirements text[],
  parsed_company text,
  parsed_role text,
  parsed_location text,
  parsed_work_type text,
  fit_analysis text,
  salary_info text,
  imported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_ads_application_id ON public.job_ads(application_id);

ALTER TABLE public.job_ads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_ads_select_own" ON public.job_ads;
DROP POLICY IF EXISTS "job_ads_insert_own" ON public.job_ads;
DROP POLICY IF EXISTS "job_ads_update_own" ON public.job_ads;
DROP POLICY IF EXISTS "job_ads_delete_own" ON public.job_ads;

CREATE POLICY "job_ads_select_own"
  ON public.job_ads FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = job_ads.application_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY "job_ads_insert_own"
  ON public.job_ads FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = job_ads.application_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY "job_ads_update_own"
  ON public.job_ads FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = job_ads.application_id AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = job_ads.application_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY "job_ads_delete_own"
  ON public.job_ads FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = job_ads.application_id AND a.user_id = auth.uid()
    )
  );

DROP TRIGGER IF EXISTS job_ads_updated_at ON public.job_ads;
CREATE TRIGGER job_ads_updated_at
  BEFORE UPDATE ON public.job_ads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
