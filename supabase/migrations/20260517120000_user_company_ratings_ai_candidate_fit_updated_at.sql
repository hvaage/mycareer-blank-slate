-- When analyze-company (or similar) writes AI candidate fit fields, record a dedicated timestamp.

ALTER TABLE public.user_company_ratings
  ADD COLUMN IF NOT EXISTS ai_candidate_fit_updated_at timestamptz;

COMMENT ON COLUMN public.user_company_ratings.ai_candidate_fit_updated_at IS
  'Set when Edge/functions persist ai_candidate_fit_score / ai_candidate_fit_reasoning.';

NOTIFY pgrst, 'reload schema';
