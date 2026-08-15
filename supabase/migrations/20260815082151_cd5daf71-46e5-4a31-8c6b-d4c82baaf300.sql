ALTER TABLE reg.enheter
  ADD COLUMN IF NOT EXISTS last_seen_in_brreg_full date,
  ADD COLUMN IF NOT EXISTS brreg_full_missing_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN reg.enheter.last_seen_in_brreg_full IS
  'Dato for siste Brreg-fullnedlasting der enheten var til stede. Uendret naar enheten mangler. NULL = aldri sett i en sporet fullnedlasting (gjelder engangsimporten fra 2026-06-15).';
COMMENT ON COLUMN reg.enheter.brreg_full_missing_count IS
  'Antall paafoelgende fullnedlastinger der enheten manglet. Nullstilles naar den ses igjen. >= 3 betyr borte fra tre nedlastinger paa rad. Rader slettes aldri.';

CREATE INDEX IF NOT EXISTS idx_enheter_brreg_full_missing
  ON reg.enheter (brreg_full_missing_count)
  WHERE brreg_full_missing_count > 0;

CREATE INDEX IF NOT EXISTS idx_enheter_last_seen_brreg_full
  ON reg.enheter (last_seen_in_brreg_full);

-- Maalt foer migrasjon: 0 regnskapsrader uten enhet-forelder av 406 798.
-- RESTRICT gjoer feilaktig sletting til en hard feil i stedet for stille foreldreloese rader.
-- NOT VALID her for aa unngaa full tabellskanning i samme transaksjon; valideres separat.
ALTER TABLE reg.regnskap
  ADD CONSTRAINT regnskap_organisasjonsnummer_fkey
  FOREIGN KEY (organisasjonsnummer)
  REFERENCES reg.enheter (organisasjonsnummer)
  ON DELETE RESTRICT
  ON UPDATE CASCADE
  NOT VALID;