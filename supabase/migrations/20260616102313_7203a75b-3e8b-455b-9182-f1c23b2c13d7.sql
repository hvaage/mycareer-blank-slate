CREATE INDEX IF NOT EXISTS idx_enheter_naering1_besk_trgm
  ON reg.enheter USING gin (naeringskode1_beskrivelse gin_trgm_ops)
  WHERE naeringskode1_beskrivelse IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enheter_naering2_besk_trgm
  ON reg.enheter USING gin (naeringskode2_beskrivelse gin_trgm_ops)
  WHERE naeringskode2_beskrivelse IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enheter_naering3_besk_trgm
  ON reg.enheter USING gin (naeringskode3_beskrivelse gin_trgm_ops)
  WHERE naeringskode3_beskrivelse IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enheter_aktivitet_trgm
  ON reg.enheter USING gin (aktivitet gin_trgm_ops)
  WHERE aktivitet IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enheter_kommune_trgm
  ON reg.enheter USING gin (forretningsadresse_kommune gin_trgm_ops)
  WHERE forretningsadresse_kommune IS NOT NULL;