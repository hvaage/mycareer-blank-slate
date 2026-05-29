ALTER TABLE public.user_job_listing_status
  ADD COLUMN IF NOT EXISTS ai_score smallint,
  ADD COLUMN IF NOT EXISTS ai_reasoning text,
  ADD COLUMN IF NOT EXISTS ai_match_highlights text,
  ADD COLUMN IF NOT EXISTS ai_concerns text,
  ADD COLUMN IF NOT EXISTS ai_scored_at timestamptz;