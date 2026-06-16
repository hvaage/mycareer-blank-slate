-- M5.4.1: målrettede indekser for kommune- og MV-join-stier i public.search_employers.
-- Ingen funksjonsendring; treffsett uendret.

CREATE INDEX IF NOT EXISTS idx_enheter_kommune_ansatte
  ON reg.enheter (forretningsadresse_kommunenummer, antall_ansatte DESC NULLS LAST)
  WHERE coalesce(slettet, false) = false;

CREATE INDEX IF NOT EXISTS idx_enheter_org_cover
  ON reg.enheter (organisasjonsnummer) INCLUDE (antall_ansatte, navn)
  WHERE coalesce(slettet, false) = false;

ANALYZE reg.enheter;