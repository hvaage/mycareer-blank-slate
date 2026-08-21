
ALTER TABLE public.linkedin_learning_staging
  ADD COLUMN IF NOT EXISTS content_type text NOT NULL DEFAULT 'course',
  ADD COLUMN IF NOT EXISTS last_watched_on text,
  ADD COLUMN IF NOT EXISTS is_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completion_status text NOT NULL DEFAULT 'missing_date',
  ADD COLUMN IF NOT EXISTS data_quality_codes text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.linkedin_learning_staging
  DROP CONSTRAINT IF EXISTS linkedin_learning_staging_completion_status_check;
ALTER TABLE public.linkedin_learning_staging
  ADD CONSTRAINT linkedin_learning_staging_completion_status_check
  CHECK (completion_status IN ('completed','in_progress','missing_date','invalid_date'));

ALTER TABLE public.linkedin_learning_staging
  DROP CONSTRAINT IF EXISTS linkedin_learning_staging_content_type_check;
ALTER TABLE public.linkedin_learning_staging
  ADD CONSTRAINT linkedin_learning_staging_content_type_check
  CHECK (content_type IN ('course','certification'));

ALTER TABLE public.linkedin_learning_staging
  DROP CONSTRAINT IF EXISTS linkedin_learning_staging_url_check;
ALTER TABLE public.linkedin_learning_staging
  ADD CONSTRAINT linkedin_learning_staging_url_check
  CHECK (content_url IS NULL OR content_url ~* '^https?://');
