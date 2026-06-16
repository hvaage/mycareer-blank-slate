CREATE INDEX IF NOT EXISTS idx_enheter_navn_trgm
  ON reg.enheter USING gin (navn gin_trgm_ops);

-- Sammensatt for orgnr-oppslag (allerede unique PK, men bekreft btree)
CREATE INDEX IF NOT EXISTS idx_enheter_organisasjonsnummer
  ON reg.enheter (organisasjonsnummer);