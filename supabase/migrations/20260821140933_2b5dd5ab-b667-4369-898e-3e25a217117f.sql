
ALTER TABLE public.linkedin_career_staging
  ADD COLUMN IF NOT EXISTS credential_id text,
  ADD COLUMN IF NOT EXISTS credential_url text;

ALTER TABLE public.linkedin_career_staging
  DROP CONSTRAINT IF EXISTS linkedin_career_staging_credential_url_check;
ALTER TABLE public.linkedin_career_staging
  ADD CONSTRAINT linkedin_career_staging_credential_url_check
  CHECK (credential_url IS NULL OR credential_url ~* '^https?://');
