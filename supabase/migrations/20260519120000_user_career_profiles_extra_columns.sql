-- Career Intelligence: extra columns on user_career_profiles (dimension weights, intent, completeness, AI review).

ALTER TABLE public.user_career_profiles
  ADD COLUMN IF NOT EXISTS dimension_weights jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS profile_intent text,
  ADD COLUMN IF NOT EXISTS completeness_score numeric,
  ADD COLUMN IF NOT EXISTS last_ai_profile_review_at timestamptz;

COMMENT ON COLUMN public.user_career_profiles.dimension_weights IS
  'Optional per-dimension user weights (e.g. MatchDimensionId -> 1–6); future adaptive scoring.';
COMMENT ON COLUMN public.user_career_profiles.profile_intent IS
  'Short free-text intent (e.g. job search vs passive); UI or AI may set later.';
COMMENT ON COLUMN public.user_career_profiles.completeness_score IS
  '0–1 or similar profile fill metric; computed client-side or by job later.';
COMMENT ON COLUMN public.user_career_profiles.last_ai_profile_review_at IS
  'When an AI pass last reviewed/summarized this profile.';

NOTIFY pgrst, 'reload schema';
