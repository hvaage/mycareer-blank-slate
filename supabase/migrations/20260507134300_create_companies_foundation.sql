-- Foundation for public.companies (must exist before 20260507134325).
-- Root cause: migrations alter/enable RLS on companies but no migration created the table.
-- RLS and "Authenticated users can read companies" remain in 20260507134325 (not duplicated here).

CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_companies_name_lower ON public.companies (lower(name));

DROP TRIGGER IF EXISTS companies_updated_at ON public.companies;
CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
