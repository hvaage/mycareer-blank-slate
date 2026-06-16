-- reg.regnskap: orgnr + år for LATERAL-join, driftsinntekter for filter
CREATE INDEX IF NOT EXISTS idx_regnskap_orgnr_aar
  ON reg.regnskap (organisasjonsnummer, regnskapsaar DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_regnskap_driftsinntekter
  ON reg.regnskap (driftsinntekter)
  WHERE driftsinntekter IS NOT NULL;

-- reg.regnskap_sync_status: orgnr lookup for join
CREATE INDEX IF NOT EXISTS idx_regnskap_sync_orgnr
  ON reg.regnskap_sync_status (organisasjonsnummer);

-- public.companies: orgnr for join fra search_employers, navn for fuzzy lookup
CREATE INDEX IF NOT EXISTS idx_companies_organisasjonsnummer
  ON public.companies (organisasjonsnummer)
  WHERE organisasjonsnummer IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_companies_name_trgm
  ON public.companies USING gin (name gin_trgm_ops)
  WHERE name IS NOT NULL;