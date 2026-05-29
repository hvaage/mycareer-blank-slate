-- Foundation for public.user_company_ratings (before 20260507134325 ALTERs it).
-- Depends on: public.companies (20260507134300), auth.users, public.set_updated_at().

CREATE TABLE IF NOT EXISTS public.user_company_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  culture_score numeric(4, 1),
  leadership_score numeric(4, 1),
  work_environment_score numeric(4, 1),
  career_development_score numeric(4, 1),
  financial_stability_score numeric(4, 1),
  mission_score numeric(4, 1),
  overall_score numeric(4, 1),
  applied_here boolean DEFAULT false,
  interviewed_here boolean DEFAULT false,
  worked_here boolean DEFAULT false,
  user_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_company_ratings_user_company_unique UNIQUE (user_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_user_company_ratings_user ON public.user_company_ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_company_ratings_company ON public.user_company_ratings(company_id);

ALTER TABLE public.user_company_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own company ratings" ON public.user_company_ratings;
DROP POLICY IF EXISTS "Users insert own company ratings" ON public.user_company_ratings;
DROP POLICY IF EXISTS "Users update own company ratings" ON public.user_company_ratings;
DROP POLICY IF EXISTS "Users delete own company ratings" ON public.user_company_ratings;

CREATE POLICY "Users own company ratings"
  ON public.user_company_ratings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own company ratings"
  ON public.user_company_ratings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own company ratings"
  ON public.user_company_ratings FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own company ratings"
  ON public.user_company_ratings FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS user_company_ratings_updated_at ON public.user_company_ratings;
CREATE TRIGGER user_company_ratings_updated_at
  BEFORE UPDATE ON public.user_company_ratings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
