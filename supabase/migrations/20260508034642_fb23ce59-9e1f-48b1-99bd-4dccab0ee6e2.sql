ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS given_name text,
  ADD COLUMN IF NOT EXISTS linkedin_email_verified boolean,
  ADD COLUMN IF NOT EXISTS linkedin_locale text;