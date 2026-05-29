-- Minimal: code + Edge functions expect companies.domain for matching / inserts.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS domain text;

CREATE INDEX IF NOT EXISTS idx_companies_domain_lower ON public.companies (lower(domain))
  WHERE domain IS NOT NULL AND length(trim(domain)) > 0;

COMMENT ON COLUMN public.companies.domain IS
  'Normalized hostname (no scheme/www) for dedupe and employer search; optional.';
