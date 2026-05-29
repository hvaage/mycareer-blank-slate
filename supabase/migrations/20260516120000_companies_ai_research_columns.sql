-- Columns written by supabase/functions/analyze-company (runCompanyAnalysis + markAnalysisFailed).
-- Minimal company tables (e.g. only id/name/created_at/updated_at/domain) must still accept AI payloads.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS ai_culture_score numeric,
  ADD COLUMN IF NOT EXISTS ai_leadership_score numeric,
  ADD COLUMN IF NOT EXISTS ai_work_environment_score numeric,
  ADD COLUMN IF NOT EXISTS ai_career_development_score numeric,
  ADD COLUMN IF NOT EXISTS ai_financial_stability_score numeric,
  ADD COLUMN IF NOT EXISTS ai_mission_score numeric,
  ADD COLUMN IF NOT EXISTS ai_overall_score numeric,
  ADD COLUMN IF NOT EXISTS ai_rating_notes text,
  ADD COLUMN IF NOT EXISTS ai_dimension_notes jsonb,
  ADD COLUMN IF NOT EXISTS financials jsonb,
  ADD COLUMN IF NOT EXISTS ai_rated_at timestamptz,
  ADD COLUMN IF NOT EXISTS research_log jsonb;

COMMENT ON COLUMN public.companies.research_log IS
  'Chronological JSON array of research/analyze events (pending, completed, failed, sources).';

NOTIFY pgrst, 'reload schema';
