GRANT SELECT ON reg.enheter_sok TO sandbox_exec;

CREATE INDEX IF NOT EXISTS idx_enheter_sok_navn_trgm
  ON reg.enheter_sok USING gin (navn gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_enheter_sok_navn_norm_trgm
  ON reg.enheter_sok USING gin (navn_norm gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_enheter_sok_navn_norm_prefix
  ON reg.enheter_sok (navn_norm text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_enheter_sok_ansatte
  ON reg.enheter_sok (antall_ansatte DESC NULLS LAST, navn);
