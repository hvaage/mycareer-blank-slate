-- M3 batch 1: lette btree-indekser på reg.enheter
-- Brukes av search_employers for fylkes-/kommune-/næring-/ansatte-filter.

CREATE INDEX IF NOT EXISTS idx_enheter_fylkesnummer
  ON reg.enheter (forretningsadresse_fylkesnummer)
  WHERE forretningsadresse_fylkesnummer IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enheter_kommunenummer
  ON reg.enheter (forretningsadresse_kommunenummer)
  WHERE forretningsadresse_kommunenummer IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enheter_naeringskode1_kode
  ON reg.enheter (naeringskode1_kode text_pattern_ops)
  WHERE naeringskode1_kode IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enheter_antall_ansatte
  ON reg.enheter (antall_ansatte)
  WHERE antall_ansatte IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enheter_organisasjonsform_kode
  ON reg.enheter (organisasjonsform_kode);

CREATE INDEX IF NOT EXISTS idx_enheter_slettet
  ON reg.enheter (slettet)
  WHERE slettet = false;
