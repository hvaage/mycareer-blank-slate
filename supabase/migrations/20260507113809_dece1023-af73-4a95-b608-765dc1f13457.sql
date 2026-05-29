ALTER TABLE public.applications 
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS recruiter_phone text;

ALTER TABLE public.job_ads
  ADD COLUMN IF NOT EXISTS about_role text,
  ADD COLUMN IF NOT EXISTS about_company text,
  ADD COLUMN IF NOT EXISTS ideal_candidate text;