-- Core company metadata for matching, target atoms, and explainability.
-- Safe on environments where some columns already exist (IF NOT EXISTS).

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS size_estimate text,
  ADD COLUMN IF NOT EXISTS ownership_type text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS description text;

COMMENT ON COLUMN public.companies.industry IS
  'Primary industry / sector label for filtering and user↔company matching (target atoms, preferences).';
COMMENT ON COLUMN public.companies.size_estimate IS
  'Human-readable company size band (e.g. headcount range) for fit heuristics and target-side atoms.';
COMMENT ON COLUMN public.companies.ownership_type IS
  'Ownership or listing context (e.g. listed, PE-backed) for risk/fit signals in matching.';
COMMENT ON COLUMN public.companies.country IS
  'Primary country / market hint (ISO or free text) for locale, regulatory, and preference alignment.';
COMMENT ON COLUMN public.companies.description IS
  'Short structured or curated company summary used as corpus for deterministic target atoms and future AI context.';

CREATE INDEX IF NOT EXISTS idx_companies_industry_lower
  ON public.companies (lower(industry));

CREATE INDEX IF NOT EXISTS idx_companies_country_lower
  ON public.companies (lower(country));

CREATE INDEX IF NOT EXISTS idx_companies_ownership_type_lower
  ON public.companies (lower(ownership_type));

NOTIFY pgrst, 'reload schema';
