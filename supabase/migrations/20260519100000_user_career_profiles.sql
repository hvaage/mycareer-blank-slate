-- Module 1: Career Intelligence — user career preference profile (adaptive matching foundation).
-- One row per auth user; additive — does not touch employer analysis or job leads.

CREATE TABLE public.user_career_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,

  career_stage text,
  leadership_level text,
  primary_industry text,
  years_experience integer CHECK (years_experience IS NULL OR years_experience >= 0),

  desired_role_types text[],
  desired_industries text[],
  preferred_company_sizes text[],
  preferred_work_styles text[],
  preferred_locations text[],

  salary_expectation_min numeric,
  salary_expectation_max numeric,
  remote_preference text,
  travel_preference text,

  stability_vs_growth integer CHECK (stability_vs_growth IS NULL OR (stability_vs_growth >= 1 AND stability_vs_growth <= 6)),
  mission_importance integer CHECK (mission_importance IS NULL OR (mission_importance >= 1 AND mission_importance <= 6)),
  innovation_importance integer CHECK (innovation_importance IS NULL OR (innovation_importance >= 1 AND innovation_importance <= 6)),
  sustainability_importance integer CHECK (sustainability_importance IS NULL OR (sustainability_importance >= 1 AND sustainability_importance <= 6)),
  work_life_balance_importance integer CHECK (work_life_balance_importance IS NULL OR (work_life_balance_importance >= 1 AND work_life_balance_importance <= 6)),
  compensation_importance integer CHECK (compensation_importance IS NULL OR (compensation_importance >= 1 AND compensation_importance <= 6)),
  leadership_ambition integer CHECK (leadership_ambition IS NULL OR (leadership_ambition >= 1 AND leadership_ambition <= 6)),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_career_profiles_user_id ON public.user_career_profiles (user_id);

COMMENT ON TABLE public.user_career_profiles IS
  'Career Intelligence module 1: structured preferences and motivation weights (1–6) for future adaptive matching; not yet wired to employer/job scoring.';

ALTER TABLE public.user_career_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_career_profiles_select_own
  ON public.user_career_profiles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY user_career_profiles_insert_own
  ON public.user_career_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY user_career_profiles_update_own
  ON public.user_career_profiles
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY user_career_profiles_delete_own
  ON public.user_career_profiles
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER set_user_career_profiles_updated_at
  BEFORE UPDATE ON public.user_career_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_career_profiles TO authenticated;

NOTIFY pgrst, 'reload schema';
