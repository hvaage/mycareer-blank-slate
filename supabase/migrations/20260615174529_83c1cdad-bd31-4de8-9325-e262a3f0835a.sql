-- Regnskapsregisteret mirror foundation.
-- Stores public key figures locally per organisation/year/type and tracks
-- backfill/refresh status for the Enhetsregisteret subset in reg.enheter.

ALTER TABLE reg.regnskap
  ADD COLUMN IF NOT EXISTS brreg_regnskap_id bigint,
  ADD COLUMN IF NOT EXISTS journalnr text,
  ADD COLUMN IF NOT EXISTS regnskapstype text NOT NULL DEFAULT 'SELSKAP',
  ADD COLUMN IF NOT EXISTS regnskap_dokumenttype text,
  ADD COLUMN IF NOT EXISTS regnskapsperiode_fra date,
  ADD COLUMN IF NOT EXISTS regnskapsperiode_til date,
  ADD COLUMN IF NOT EXISTS morselskap boolean,
  ADD COLUMN IF NOT EXISTS avviklingsregnskap boolean,
  ADD COLUMN IF NOT EXISTS oppstillingsplan text,
  ADD COLUMN IF NOT EXISTS smaa_foretak boolean,
  ADD COLUMN IF NOT EXISTS regnskapsregler text,
  ADD COLUMN IF NOT EXISTS ikke_revidert_aarsregnskap boolean,
  ADD COLUMN IF NOT EXISTS fravalg_revisjon boolean,
  ADD COLUMN IF NOT EXISTS sum_egenkapital_gjeld numeric,
  ADD COLUMN IF NOT EXISTS sum_omloepsmidler numeric,
  ADD COLUMN IF NOT EXISTS sum_anleggsmidler numeric,
  ADD COLUMN IF NOT EXISTS sum_driftskostnad numeric,
  ADD COLUMN IF NOT EXISTS sum_finansinntekter numeric,
  ADD COLUMN IF NOT EXISTS sum_finanskostnad numeric;

UPDATE reg.regnskap
SET regnskapstype = COALESCE(NULLIF(regnskapstype, ''), raw_data->>'regnskapstype', 'SELSKAP')
WHERE regnskapstype IS NULL OR regnskapstype = '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'regnskap_organisasjonsnummer_regnskapsaar_key'
      AND conrelid = 'reg.regnskap'::regclass
  ) THEN
    ALTER TABLE reg.regnskap
      DROP CONSTRAINT regnskap_organisasjonsnummer_regnskapsaar_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS regnskap_org_year_type_key
  ON reg.regnskap (organisasjonsnummer, regnskapsaar, regnskapstype);

CREATE INDEX IF NOT EXISTS idx_regnskap_org_year
  ON reg.regnskap (organisasjonsnummer, regnskapsaar DESC);

CREATE INDEX IF NOT EXISTS idx_regnskap_brreg_id
  ON reg.regnskap (brreg_regnskap_id)
  WHERE brreg_regnskap_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS reg.regnskap_sync_status (
  organisasjonsnummer text PRIMARY KEY,
  status text NOT NULL DEFAULT 'pending',
  last_checked_at timestamptz,
  last_success_at timestamptz,
  latest_regnskapsaar integer,
  records_lagret integer NOT NULL DEFAULT 0,
  available_pdf_years text[],
  last_http_status integer,
  last_error text,
  attempts integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_regnskap_sync_status_due
  ON reg.regnskap_sync_status (last_checked_at, status);

CREATE INDEX IF NOT EXISTS idx_regnskap_sync_status_latest_year
  ON reg.regnskap_sync_status (latest_regnskapsaar DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS reg.regnskap_sync_runs (
  id bigserial PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  scope text NOT NULL DEFAULT 'enheter_subset',
  dry_run boolean NOT NULL DEFAULT false,
  max_orgs integer NOT NULL,
  stale_days integer NOT NULL,
  selected_count integer NOT NULL DEFAULT 0,
  checked_count integer NOT NULL DEFAULT 0,
  with_regnskap_count integer NOT NULL DEFAULT 0,
  no_regnskap_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  records_lagret integer NOT NULL DEFAULT 0,
  last_error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE VIEW reg.arbeidsgiver_regnskap_alle_aar AS
SELECT
  e.organisasjonsnummer,
  e.navn,
  e.organisasjonsform_kode,
  e.organisasjonsform_beskrivelse,
  e.naeringskode1_kode,
  e.naeringskode1_beskrivelse,
  e.antall_ansatte,
  e.har_registrert_antall_ansatte,
  e.forretningsadresse_poststed,
  e.forretningsadresse_postnummer,
  e.forretningsadresse_kommune,
  e.forretningsadresse_kommunenummer,
  e.institusjonell_sektorkode,
  e.stiftelsesdato,
  e.konkurs,
  e.under_avvikling,
  e.slettet,
  e.er_offentlig,
  e.er_utdanning,
  e.er_rekruttering,
  r.regnskapsaar,
  r.regnskapstype,
  r.regnskapsperiode_fra,
  r.regnskapsperiode_til,
  r.driftsinntekter,
  r.driftsresultat,
  r.aarsresultat,
  r.sum_egenkapital,
  r.sum_gjeld,
  r.sum_eiendeler,
  r.sum_egenkapital_gjeld,
  r.sum_omloepsmidler,
  r.sum_anleggsmidler,
  r.sum_driftskostnad,
  r.sum_finansinntekter,
  r.sum_finanskostnad,
  r.valuta,
  r.hentet_tidspunkt,
  s.status AS regnskap_sync_status,
  s.last_checked_at AS regnskap_last_checked_at,
  s.available_pdf_years
FROM reg.enheter e
LEFT JOIN reg.regnskap r
  ON r.organisasjonsnummer = e.organisasjonsnummer
LEFT JOIN reg.regnskap_sync_status s
  ON s.organisasjonsnummer = e.organisasjonsnummer;

CREATE OR REPLACE VIEW reg.arbeidsgiver_regnskap_siste AS
SELECT
  e.organisasjonsnummer,
  e.navn,
  e.organisasjonsform_kode,
  e.organisasjonsform_beskrivelse,
  e.naeringskode1_kode,
  e.naeringskode1_beskrivelse,
  e.antall_ansatte,
  e.har_registrert_antall_ansatte,
  e.forretningsadresse_poststed,
  e.forretningsadresse_postnummer,
  e.forretningsadresse_kommune,
  e.forretningsadresse_kommunenummer,
  e.institusjonell_sektorkode,
  e.stiftelsesdato,
  e.konkurs,
  e.under_avvikling,
  e.slettet,
  e.er_offentlig,
  e.er_utdanning,
  e.er_rekruttering,
  r.regnskapsaar,
  r.regnskapstype,
  r.regnskapsperiode_fra,
  r.regnskapsperiode_til,
  r.driftsinntekter,
  r.driftsresultat,
  r.aarsresultat,
  r.sum_egenkapital,
  r.sum_gjeld,
  r.sum_eiendeler,
  r.sum_egenkapital_gjeld,
  r.sum_omloepsmidler,
  r.sum_anleggsmidler,
  r.sum_driftskostnad,
  r.sum_finansinntekter,
  r.sum_finanskostnad,
  r.valuta,
  r.hentet_tidspunkt,
  s.status AS regnskap_sync_status,
  s.last_checked_at AS regnskap_last_checked_at,
  s.available_pdf_years
FROM reg.enheter e
LEFT JOIN LATERAL (
  SELECT *
  FROM reg.regnskap r
  WHERE r.organisasjonsnummer = e.organisasjonsnummer
  ORDER BY r.regnskapsaar DESC NULLS LAST,
    CASE WHEN r.regnskapstype = 'SELSKAP' THEN 0 ELSE 1 END,
    r.hentet_tidspunkt DESC NULLS LAST
  LIMIT 1
) r ON true
LEFT JOIN reg.regnskap_sync_status s
  ON s.organisasjonsnummer = e.organisasjonsnummer;