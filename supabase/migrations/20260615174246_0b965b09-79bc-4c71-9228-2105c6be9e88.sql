CREATE SCHEMA IF NOT EXISTS reg;

CREATE TABLE IF NOT EXISTS reg.enheter (
  organisasjonsnummer text PRIMARY KEY,
  navn text,
  organisasjonsform_kode text,
  organisasjonsform_beskrivelse text,
  naeringskode1_kode text,
  naeringskode1_beskrivelse text,
  antall_ansatte integer,
  har_registrert_antall_ansatte boolean,
  forretningsadresse_poststed text,
  forretningsadresse_postnummer text,
  forretningsadresse_kommune text,
  forretningsadresse_kommunenummer text,
  institusjonell_sektorkode text,
  stiftelsesdato date,
  konkurs boolean,
  under_avvikling boolean,
  slettet boolean,
  er_offentlig boolean,
  er_utdanning boolean,
  er_rekruttering boolean,
  registrert_i_foretaksregisteret boolean,
  raw_data jsonb,
  oppdatert_tidspunkt timestamptz NOT NULL DEFAULT now(),
  hentet_tidspunkt timestamptz
);

CREATE TABLE IF NOT EXISTS reg.regnskap (
  id bigserial PRIMARY KEY,
  organisasjonsnummer text NOT NULL,
  regnskapsaar integer NOT NULL,
  driftsinntekter numeric,
  driftsresultat numeric,
  aarsresultat numeric,
  sum_egenkapital numeric,
  sum_gjeld numeric,
  sum_eiendeler numeric,
  valuta text,
  raw_data jsonb,
  hentet_tidspunkt timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regnskap_organisasjonsnummer_regnskapsaar_key
    UNIQUE (organisasjonsnummer, regnskapsaar)
);

CREATE TABLE IF NOT EXISTS reg.kommune_fylke (
  kommunenummer text PRIMARY KEY,
  kommunenavn text,
  fylkesnummer text NOT NULL,
  fylkesnavn text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reg.sync_log (
  id bigserial PRIMARY KEY,
  source text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  records_in integer NOT NULL DEFAULT 0,
  records_written integer NOT NULL DEFAULT 0,
  last_error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_reg_sync_log_source_started
  ON reg.sync_log (source, started_at DESC);