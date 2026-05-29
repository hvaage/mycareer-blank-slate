
-- RLS for companies: only SELECT for authenticated
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read companies" ON public.companies;
CREATE POLICY "Authenticated users can read companies"
  ON public.companies FOR SELECT
  USING (auth.role() = 'authenticated');

-- Move candidate fit score to per-user table
ALTER TABLE public.user_company_ratings
  ADD COLUMN IF NOT EXISTS ai_candidate_fit_score numeric(3,1);

ALTER TABLE public.companies DROP COLUMN IF EXISTS ai_candidate_fit_score;

-- Link applications to companies (nullable, populated by AI)
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
CREATE INDEX IF NOT EXISTS idx_applications_company_id ON public.applications(company_id);

-- Unique constraint for upsert in user_company_ratings
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_company_ratings_user_company_unique'
  ) THEN
    ALTER TABLE public.user_company_ratings
      ADD CONSTRAINT user_company_ratings_user_company_unique UNIQUE (user_id, company_id);
  END IF;
END $$;

-- RPC function for fetching user's employers
CREATE OR REPLACE FUNCTION public.get_user_employers(p_user_id uuid)
RETURNS TABLE (company_id uuid, source text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT c.id, 'application'::text FROM applications a
    JOIN companies c ON c.id = a.company_id
    WHERE a.user_id = p_user_id AND a.company_id IS NOT NULL
  UNION
  SELECT DISTINCT c.id, 'name_match'::text FROM applications a
    JOIN companies c ON lower(c.name) = lower(a.company_name)
    WHERE a.user_id = p_user_id AND a.company_id IS NULL
  UNION
  SELECT DISTINCT ucr.company_id, 'rating'::text FROM user_company_ratings ucr
    WHERE ucr.user_id = p_user_id AND ucr.company_id IS NOT NULL
$$;

GRANT EXECUTE ON FUNCTION public.get_user_employers(uuid) TO authenticated;
