-- Enhetsspeil: fullnedlasting fra Brreg hver 14. dag.
-- Fase 1 laster ned til Storage og verifiserer filstørrelse mot content-length.
-- Fase 2 parser og mellomlagrer. Fase 3 kjører sammenligningsporten og upserter.

CREATE TABLE IF NOT EXISTS reg.brreg_full_sync_runs (
  id bigserial PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  -- phase1_download | phase2_parse | phase3_merge | done | failed
  phase text NOT NULL DEFAULT 'phase1_download',
  -- running | ok | partial | failed | blocked
  status text NOT NULL DEFAULT 'running',

  -- Fase 1: filintegritet. Fase 2 nekter å starte hvis disse ikke stemmer.
  storage_bucket text,
  storage_path text,
  expected_bytes bigint,
  actual_bytes bigint,
  integrity_ok boolean,
  integrity_reason text,
  download_ms integer,

  -- Fase 2: radmarkør og tellere
  row_cursor bigint NOT NULL DEFAULT 0,
  rows_seen bigint NOT NULL DEFAULT 0,
  rows_staged bigint NOT NULL DEFAULT 0,
  rows_excluded bigint NOT NULL DEFAULT 0,
  shard_count integer NOT NULL DEFAULT 0,
  parse_complete boolean NOT NULL DEFAULT false,

  -- Fase 3: sammenligningsport og skriving
  strict_gate boolean NOT NULL DEFAULT false,
  gate_pass boolean,
  gate jsonb,
  rows_upserted bigint NOT NULL DEFAULT 0,
  rows_missing bigint NOT NULL DEFAULT 0,

  error text,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brreg_full_sync_runs_started
  ON reg.brreg_full_sync_runs (started_at DESC);

CREATE OR REPLACE FUNCTION reg.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_brreg_full_sync_runs_updated_at ON reg.brreg_full_sync_runs;
CREATE TRIGGER trg_brreg_full_sync_runs_updated_at
  BEFORE UPDATE ON reg.brreg_full_sync_runs
  FOR EACH ROW EXECUTE FUNCTION reg.set_updated_at();

-- Mellomlager for fase 2. Upsert-only, tømmes per kjøring.
CREATE UNLOGGED TABLE IF NOT EXISTS reg.brreg_full_staging (
  run_id bigint NOT NULL,
  organisasjonsnummer text NOT NULL,
  navn text,
  organisasjonsform_kode text,
  organisasjonsform_beskrivelse text,
  naeringskode1_kode text,
  naeringskode1_beskrivelse text,
  naeringskode2_kode text,
  naeringskode2_beskrivelse text,
  naeringskode3_kode text,
  naeringskode3_beskrivelse text,
  antall_ansatte integer,
  har_registrert_antall_ansatte boolean,
  forretningsadresse_poststed text,
  forretningsadresse_postnummer text,
  forretningsadresse_kommune text,
  forretningsadresse_kommunenummer text,
  postadresse_poststed text,
  postadresse_postnummer text,
  postadresse_kommune text,
  postadresse_kommunenummer text,
  institusjonell_sektorkode text,
  stiftelsesdato date,
  registreringsdato_enhetsregisteret date,
  konkurs boolean,
  konkursdato date,
  under_avvikling boolean,
  under_avvikling_dato date,
  under_tvangsavvikling_eller_tvangsopplosning boolean,
  slettet boolean,
  registrert_i_foretaksregisteret boolean,
  registrert_i_mvaregisteret boolean,
  registrert_i_frivillighetsregisteret boolean,
  registrert_i_stiftelsesregisteret boolean,
  registrert_i_partiregisteret boolean,
  hjemmeside text,
  epostadresse text,
  telefon text,
  mobil text,
  maalform text,
  aktivitet text,
  vedtektsdato date,
  vedtektsfestet_formaal text,
  siste_innsendte_aarsregnskap text,
  overordnet_enhet text,
  er_utdanning boolean,
  er_rekruttering boolean,
  er_offentlig boolean,
  er_i_konsern boolean,
  PRIMARY KEY (run_id, organisasjonsnummer)
);

-- Rader fullfilen inneholder, men filteret forkastet. Beviset på om
-- rekonstruksjonen av filteret er fullstendig. Skal rapporteres, aldri slettes
-- fra reg.enheter.
CREATE UNLOGGED TABLE IF NOT EXISTS reg.brreg_full_excluded (
  run_id bigint NOT NULL,
  organisasjonsnummer text NOT NULL,
  reason text NOT NULL,
  PRIMARY KEY (run_id, organisasjonsnummer)
);