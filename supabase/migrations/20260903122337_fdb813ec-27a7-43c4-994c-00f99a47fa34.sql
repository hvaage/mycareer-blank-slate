ALTER TABLE public.user_career_profiles
  ADD COLUMN IF NOT EXISTS age_group text,
  ADD COLUMN IF NOT EXISTS current_occupation_esco_uri text,
  ADD COLUMN IF NOT EXISTS current_occupation_title text,
  ADD COLUMN IF NOT EXISTS current_occupation_source text;

ALTER TABLE public.user_career_profiles
  DROP CONSTRAINT IF EXISTS user_career_profiles_age_group_check;
ALTER TABLE public.user_career_profiles
  ADD CONSTRAINT user_career_profiles_age_group_check
  CHECK (age_group IS NULL OR age_group IN ('00-24','25-29','30-34','35-39','40-44','45-49','50-54','55-59','60-'));

ALTER TABLE public.user_career_profiles
  DROP CONSTRAINT IF EXISTS user_career_profiles_occupation_source_check;
ALTER TABLE public.user_career_profiles
  ADD CONSTRAINT user_career_profiles_occupation_source_check
  CHECK (current_occupation_source IS NULL OR current_occupation_source IN ('search','ai_suggestion'));

COMMENT ON COLUMN public.user_career_profiles.age_group IS 'SSB-aldersintervall, kun brukt til lønnssammenligning og kontekst i forslag.';
COMMENT ON COLUMN public.user_career_profiles.current_occupation_esco_uri IS 'ESCO-URI for brukerens nåværende stilling, bekreftet av brukeren selv.';