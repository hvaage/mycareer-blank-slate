SET statement_timeout = '15min';

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- Kommune-/fylke-hjelpere ----------
CREATE OR REPLACE FUNCTION reg.fylkesnavn_for_fylkesnummer(p_fylkesnummer text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE NULLIF(trim(p_fylkesnummer), '')
    WHEN '01' THEN 'Østfold'
    WHEN '02' THEN 'Akershus'
    WHEN '03' THEN 'Oslo'
    WHEN '04' THEN 'Hedmark'
    WHEN '05' THEN 'Oppland'
    WHEN '06' THEN 'Buskerud'
    WHEN '07' THEN 'Vestfold'
    WHEN '08' THEN 'Telemark'
    WHEN '09' THEN 'Aust-Agder'
    WHEN '10' THEN 'Vest-Agder'
    WHEN '11' THEN 'Rogaland'
    WHEN '12' THEN 'Hordaland'
    WHEN '14' THEN 'Sogn og Fjordane'
    WHEN '15' THEN 'Møre og Romsdal'
    WHEN '16' THEN 'Sør-Trøndelag'
    WHEN '17' THEN 'Nord-Trøndelag'
    WHEN '18' THEN 'Nordland'
    WHEN '19' THEN 'Troms'
    WHEN '20' THEN 'Finnmark'
    WHEN '21' THEN 'Svalbard'
    WHEN '22' THEN 'Jan Mayen'
    WHEN '30' THEN 'Viken'
    WHEN '31' THEN 'Østfold'
    WHEN '32' THEN 'Akershus'
    WHEN '33' THEN 'Buskerud'
    WHEN '34' THEN 'Innlandet'
    WHEN '38' THEN 'Vestfold og Telemark'
    WHEN '39' THEN 'Vestfold'
    WHEN '40' THEN 'Telemark'
    WHEN '42' THEN 'Agder'
    WHEN '46' THEN 'Vestland'
    WHEN '50' THEN 'Trøndelag'
    WHEN '54' THEN 'Troms og Finnmark'
    WHEN '55' THEN 'Troms'
    WHEN '56' THEN 'Finnmark'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION reg.fylkesnummer_for_kommunenummer(p_kommunenummer text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_kommunenummer ~ '^[0-9]{4}$' THEN substring(p_kommunenummer from 1 for 2)
    ELSE NULL
  END;
$$;

CREATE TABLE IF NOT EXISTS reg.kommune_fylke (
  kommunenummer text PRIMARY KEY,
  kommunenavn text,
  fylkesnummer text NOT NULL,
  fylkesnavn text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reg.enheter
  ADD COLUMN IF NOT EXISTS forretningsadresse_fylkesnummer text,
  ADD COLUMN IF NOT EXISTS forretningsadresse_fylke text,
  ADD COLUMN IF NOT EXISTS postadresse_poststed text,
  ADD COLUMN IF NOT EXISTS postadresse_postnummer text,
  ADD COLUMN IF NOT EXISTS postadresse_kommune text,
  ADD COLUMN IF NOT EXISTS postadresse_kommunenummer text,
  ADD COLUMN IF NOT EXISTS postadresse_fylkesnummer text,
  ADD COLUMN IF NOT EXISTS postadresse_fylke text,
  ADD COLUMN IF NOT EXISTS hjemmeside text,
  ADD COLUMN IF NOT EXISTS epostadresse text,
  ADD COLUMN IF NOT EXISTS telefon text,
  ADD COLUMN IF NOT EXISTS mobil text,
  ADD COLUMN IF NOT EXISTS aktivitet text,
  ADD COLUMN IF NOT EXISTS maalform text,
  ADD COLUMN IF NOT EXISTS naeringskode2_kode text,
  ADD COLUMN IF NOT EXISTS naeringskode2_beskrivelse text,
  ADD COLUMN IF NOT EXISTS naeringskode3_kode text,
  ADD COLUMN IF NOT EXISTS naeringskode3_beskrivelse text,
  ADD COLUMN IF NOT EXISTS overordnet_enhet text,
  ADD COLUMN IF NOT EXISTS er_i_konsern boolean,
  ADD COLUMN IF NOT EXISTS registreringsdato_enhetsregisteret date,
  ADD COLUMN IF NOT EXISTS registreringsdato_foretaksregisteret date,
  ADD COLUMN IF NOT EXISTS registreringsdato_merverdiavgiftsregisteret date,
  ADD COLUMN IF NOT EXISTS registreringsdato_frivillighetsregisteret date,
  ADD COLUMN IF NOT EXISTS registrert_i_mvaregisteret boolean,
  ADD COLUMN IF NOT EXISTS registrert_i_frivillighetsregisteret boolean,
  ADD COLUMN IF NOT EXISTS registrert_i_stiftelsesregisteret boolean,
  ADD COLUMN IF NOT EXISTS registrert_i_partiregisteret boolean,
  ADD COLUMN IF NOT EXISTS under_tvangsavvikling_eller_tvangsopplosning boolean,
  ADD COLUMN IF NOT EXISTS konkursdato date,
  ADD COLUMN IF NOT EXISTS under_avvikling_dato date,
  ADD COLUMN IF NOT EXISTS vedtektsdato date,
  ADD COLUMN IF NOT EXISTS vedtektsfestet_formaal text,
  ADD COLUMN IF NOT EXISTS siste_innsendte_aarsregnskap text,
  ADD COLUMN IF NOT EXISTS kapital_raw jsonb,
  ADD COLUMN IF NOT EXISTS paategninger_raw jsonb,
  ADD COLUMN IF NOT EXISTS links_raw jsonb,
  ADD COLUMN IF NOT EXISTS raw_data_lifted_at timestamptz;

CREATE OR REPLACE FUNCTION reg.refresh_kommune_fylke_from_enheter()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = reg, public
AS $$
DECLARE
  affected integer := 0;
BEGIN
  INSERT INTO reg.kommune_fylke (kommunenummer, kommunenavn, fylkesnummer, fylkesnavn, updated_at)
  SELECT
    forretningsadresse_kommunenummer,
    max(forretningsadresse_kommune),
    reg.fylkesnummer_for_kommunenummer(forretningsadresse_kommunenummer),
    reg.fylkesnavn_for_fylkesnummer(reg.fylkesnummer_for_kommunenummer(forretningsadresse_kommunenummer)),
    now()
  FROM reg.enheter
  WHERE forretningsadresse_kommunenummer ~ '^[0-9]{4}$'
    AND reg.fylkesnavn_for_fylkesnummer(reg.fylkesnummer_for_kommunenummer(forretningsadresse_kommunenummer)) IS NOT NULL
  GROUP BY forretningsadresse_kommunenummer
  ON CONFLICT (kommunenummer) DO UPDATE SET
    kommunenavn = excluded.kommunenavn,
    fylkesnummer = excluded.fylkesnummer,
    fylkesnavn = excluded.fylkesnavn,
    updated_at = now();

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION reg.backfill_enheter_register_fields(p_batch_size integer DEFAULT 10000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = reg, public
AS $$
DECLARE
  affected integer := 0;
BEGIN
  WITH target AS (
    SELECT organisasjonsnummer
    FROM reg.enheter
    WHERE raw_data IS NOT NULL
      AND (
        raw_data_lifted_at IS NULL
        OR raw_data_lifted_at < oppdatert_tidspunkt
      )
    ORDER BY organisasjonsnummer
    LIMIT LEAST(GREATEST(COALESCE(p_batch_size, 10000), 1), 50000)
  )
  UPDATE reg.enheter e
  SET
    forretningsadresse_fylkesnummer = reg.fylkesnummer_for_kommunenummer(e.forretningsadresse_kommunenummer),
    forretningsadresse_fylke = reg.fylkesnavn_for_fylkesnummer(reg.fylkesnummer_for_kommunenummer(e.forretningsadresse_kommunenummer)),
    postadresse_poststed = e.raw_data #>> '{postadresse,poststed}',
    postadresse_postnummer = e.raw_data #>> '{postadresse,postnummer}',
    postadresse_kommune = e.raw_data #>> '{postadresse,kommune}',
    postadresse_kommunenummer = e.raw_data #>> '{postadresse,kommunenummer}',
    postadresse_fylkesnummer = reg.fylkesnummer_for_kommunenummer(e.raw_data #>> '{postadresse,kommunenummer}'),
    postadresse_fylke = reg.fylkesnavn_for_fylkesnummer(reg.fylkesnummer_for_kommunenummer(e.raw_data #>> '{postadresse,kommunenummer}')),
    hjemmeside = nullif(e.raw_data ->> 'hjemmeside', ''),
    epostadresse = nullif(e.raw_data ->> 'epostadresse', ''),
    telefon = nullif(e.raw_data ->> 'telefon', ''),
    mobil = nullif(e.raw_data ->> 'mobil', ''),
    aktivitet = nullif(e.raw_data ->> 'aktivitet', ''),
    maalform = nullif(e.raw_data ->> 'maalform', ''),
    naeringskode2_kode = e.raw_data #>> '{naeringskode2,kode}',
    naeringskode2_beskrivelse = e.raw_data #>> '{naeringskode2,beskrivelse}',
    naeringskode3_kode = e.raw_data #>> '{naeringskode3,kode}',
    naeringskode3_beskrivelse = e.raw_data #>> '{naeringskode3,beskrivelse}',
    overordnet_enhet = nullif(e.raw_data ->> 'overordnetEnhet', ''),
    er_i_konsern = CASE WHEN e.raw_data ? 'erIKonsern' THEN (e.raw_data ->> 'erIKonsern')::boolean ELSE e.er_i_konsern END,
    registreringsdato_enhetsregisteret = CASE WHEN e.raw_data ->> 'registreringsdatoEnhetsregisteret' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (e.raw_data ->> 'registreringsdatoEnhetsregisteret')::date ELSE e.registreringsdato_enhetsregisteret END,
    registreringsdato_foretaksregisteret = CASE WHEN e.raw_data ->> 'registreringsdatoForetaksregisteret' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (e.raw_data ->> 'registreringsdatoForetaksregisteret')::date ELSE e.registreringsdato_foretaksregisteret END,
    registreringsdato_merverdiavgiftsregisteret = CASE WHEN e.raw_data ->> 'registreringsdatoMerverdiavgiftsregisteret' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (e.raw_data ->> 'registreringsdatoMerverdiavgiftsregisteret')::date ELSE e.registreringsdato_merverdiavgiftsregisteret END,
    registreringsdato_frivillighetsregisteret = CASE WHEN e.raw_data ->> 'registreringsdatoFrivillighetsregisteret' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (e.raw_data ->> 'registreringsdatoFrivillighetsregisteret')::date ELSE e.registreringsdato_frivillighetsregisteret END,
    registrert_i_mvaregisteret = CASE WHEN e.raw_data ? 'registrertIMvaregisteret' THEN (e.raw_data ->> 'registrertIMvaregisteret')::boolean ELSE e.registrert_i_mvaregisteret END,
    registrert_i_frivillighetsregisteret = CASE WHEN e.raw_data ? 'registrertIFrivillighetsregisteret' THEN (e.raw_data ->> 'registrertIFrivillighetsregisteret')::boolean ELSE e.registrert_i_frivillighetsregisteret END,
    registrert_i_stiftelsesregisteret = CASE WHEN e.raw_data ? 'registrertIStiftelsesregisteret' THEN (e.raw_data ->> 'registrertIStiftelsesregisteret')::boolean ELSE e.registrert_i_stiftelsesregisteret END,
    registrert_i_partiregisteret = CASE WHEN e.raw_data ? 'registrertIPartiregisteret' THEN (e.raw_data ->> 'registrertIPartiregisteret')::boolean ELSE e.registrert_i_partiregisteret END,
    under_tvangsavvikling_eller_tvangsopplosning = CASE WHEN e.raw_data ? 'underTvangsavviklingEllerTvangsopplosning' THEN (e.raw_data ->> 'underTvangsavviklingEllerTvangsopplosning')::boolean ELSE e.under_tvangsavvikling_eller_tvangsopplosning END,
    konkursdato = CASE WHEN e.raw_data ->> 'konkursdato' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (e.raw_data ->> 'konkursdato')::date ELSE e.konkursdato END,
    under_avvikling_dato = CASE WHEN e.raw_data ->> 'underAvviklingDato' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (e.raw_data ->> 'underAvviklingDato')::date ELSE e.under_avvikling_dato END,
    vedtektsdato = CASE WHEN e.raw_data ->> 'vedtektsdato' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (e.raw_data ->> 'vedtektsdato')::date ELSE e.vedtektsdato END,
    vedtektsfestet_formaal = nullif(e.raw_data ->> 'vedtektsfestetFormaal', ''),
    siste_innsendte_aarsregnskap = nullif(e.raw_data ->> 'sisteInnsendteAarsregnskap', ''),
    kapital_raw = e.raw_data -> 'kapital',
    paategninger_raw = e.raw_data -> 'paategninger',
    links_raw = e.raw_data -> 'links',
    raw_data_lifted_at = now()
  FROM target t
  WHERE e.organisasjonsnummer = t.organisasjonsnummer;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS organisasjonsnummer text,
  ADD COLUMN IF NOT EXISTS brreg_matched_at timestamptz,
  ADD COLUMN IF NOT EXISTS brreg_match_source text,
  ADD COLUMN IF NOT EXISTS brreg_match_confidence numeric,
  ADD COLUMN IF NOT EXISTS domain text,
  ADD COLUMN IF NOT EXISTS financials jsonb,
  ADD COLUMN IF NOT EXISTS ai_culture_score numeric,
  ADD COLUMN IF NOT EXISTS ai_leadership_score numeric,
  ADD COLUMN IF NOT EXISTS ai_work_environment_score numeric,
  ADD COLUMN IF NOT EXISTS ai_career_development_score numeric,
  ADD COLUMN IF NOT EXISTS ai_financial_stability_score numeric,
  ADD COLUMN IF NOT EXISTS ai_mission_score numeric,
  ADD COLUMN IF NOT EXISTS ai_overall_score numeric,
  ADD COLUMN IF NOT EXISTS ai_rating_notes text,
  ADD COLUMN IF NOT EXISTS ai_dimension_notes jsonb,
  ADD COLUMN IF NOT EXISTS ai_rated_at timestamptz,
  ADD COLUMN IF NOT EXISTS agg_culture_score numeric,
  ADD COLUMN IF NOT EXISTS agg_leadership_score numeric,
  ADD COLUMN IF NOT EXISTS agg_work_environment_score numeric,
  ADD COLUMN IF NOT EXISTS agg_career_development_score numeric,
  ADD COLUMN IF NOT EXISTS agg_financial_stability_score numeric,
  ADD COLUMN IF NOT EXISTS agg_mission_score numeric,
  ADD COLUMN IF NOT EXISTS agg_overall_score numeric,
  ADD COLUMN IF NOT EXISTS agg_rating_count integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.companies'::regclass
      AND conname = 'companies_organisasjonsnummer_format_chk'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_organisasjonsnummer_format_chk
      CHECK (organisasjonsnummer IS NULL OR organisasjonsnummer ~ '^[0-9]{9}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_organisasjonsnummer_unique
  ON public.companies (organisasjonsnummer)
  WHERE organisasjonsnummer IS NOT NULL;

CREATE OR REPLACE VIEW public.employer_search_v1 AS
WITH latest_regnskap AS (
  SELECT DISTINCT ON (r.organisasjonsnummer)
    r.*
  FROM reg.regnskap r
  ORDER BY
    r.organisasjonsnummer,
    r.regnskapsaar DESC NULLS LAST,
    CASE WHEN r.regnskapstype = 'SELSKAP' THEN 0 ELSE 1 END,
    r.hentet_tidspunkt DESC NULLS LAST
)
SELECT
  e.organisasjonsnummer,
  c.id AS company_id,
  e.navn,
  c.domain,
  e.organisasjonsform_kode,
  e.organisasjonsform_beskrivelse,
  e.naeringskode1_kode,
  e.naeringskode1_beskrivelse,
  e.naeringskode2_kode,
  e.naeringskode2_beskrivelse,
  e.naeringskode3_kode,
  e.naeringskode3_beskrivelse,
  e.antall_ansatte,
  CASE
    WHEN e.antall_ansatte IS NULL THEN 'ukjent'
    WHEN e.antall_ansatte = 0 THEN '0'
    WHEN e.antall_ansatte BETWEEN 1 AND 4 THEN '1-4'
    WHEN e.antall_ansatte BETWEEN 5 AND 19 THEN '5-19'
    WHEN e.antall_ansatte BETWEEN 20 AND 99 THEN '20-99'
    WHEN e.antall_ansatte BETWEEN 100 AND 499 THEN '100-499'
    ELSE '500+'
  END AS ansatte_bucket,
  e.har_registrert_antall_ansatte,
  e.forretningsadresse_poststed,
  e.forretningsadresse_postnummer,
  e.forretningsadresse_kommune,
  e.forretningsadresse_kommunenummer,
  e.forretningsadresse_fylkesnummer,
  e.forretningsadresse_fylke,
  e.hjemmeside,
  e.aktivitet,
  e.institusjonell_sektorkode,
  e.stiftelsesdato,
  CASE
    WHEN e.stiftelsesdato IS NULL THEN NULL
    ELSE date_part('year', age(current_date, e.stiftelsesdato))::int
  END AS selskapsalder_aar,
  e.registrert_i_foretaksregisteret,
  e.registrert_i_mvaregisteret,
  e.registrert_i_frivillighetsregisteret,
  e.er_i_konsern,
  e.overordnet_enhet,
  e.konkurs,
  e.under_avvikling,
  e.under_tvangsavvikling_eller_tvangsopplosning,
  e.slettet,
  e.er_offentlig,
  e.er_utdanning,
  e.er_rekruttering,
  CASE
    WHEN e.organisasjonsform_kode IN ('STAT', 'SF', 'HF') THEN 'statlig'
    WHEN e.organisasjonsform_kode IN ('KOMM', 'FYLK', 'KF', 'FKF', 'IKS') THEN 'kommunal_fylkeskommunal'
    WHEN e.er_offentlig THEN 'offentlig'
    WHEN e.organisasjonsform_kode IN ('FLI', 'STI') THEN 'ideell_stiftelse'
    ELSE 'privat'
  END AS arbeidsgiver_type,
  lr.regnskapsaar,
  lr.regnskapstype,
  lr.regnskapsperiode_fra,
  lr.regnskapsperiode_til,
  lr.driftsinntekter,
  lr.driftsresultat,
  lr.aarsresultat,
  lr.sum_egenkapital,
  lr.sum_gjeld,
  lr.sum_eiendeler,
  lr.sum_egenkapital_gjeld,
  lr.sum_omloepsmidler,
  lr.sum_anleggsmidler,
  lr.sum_driftskostnad,
  lr.sum_finansinntekter,
  lr.sum_finanskostnad,
  lr.valuta,
  lr.hentet_tidspunkt AS regnskap_hentet_tidspunkt,
  CASE
    WHEN lr.driftsinntekter IS NULL THEN 'ukjent'
    WHEN lr.driftsinntekter < 1000000 THEN '<1m'
    WHEN lr.driftsinntekter < 10000000 THEN '1-10m'
    WHEN lr.driftsinntekter < 50000000 THEN '10-50m'
    WHEN lr.driftsinntekter < 250000000 THEN '50-250m'
    ELSE '250m+'
  END AS omsetning_bucket,
  CASE WHEN lr.driftsinntekter IS NOT NULL AND lr.driftsinntekter <> 0
    THEN round((lr.driftsresultat / lr.driftsinntekter) * 100, 2)
  END AS driftsmargin_prosent,
  CASE WHEN lr.driftsinntekter IS NOT NULL AND lr.driftsinntekter <> 0
    THEN round((lr.aarsresultat / lr.driftsinntekter) * 100, 2)
  END AS aarsresultat_margin_prosent,
  CASE WHEN lr.sum_eiendeler IS NOT NULL AND lr.sum_eiendeler <> 0
    THEN round((lr.sum_egenkapital / lr.sum_eiendeler) * 100, 2)
  END AS egenkapitalandel_prosent,
  CASE WHEN lr.sum_egenkapital IS NOT NULL AND lr.sum_egenkapital <> 0
    THEN round(lr.sum_gjeld / lr.sum_egenkapital, 2)
  END AS gjeldsgrad,
  CASE WHEN e.antall_ansatte IS NOT NULL AND e.antall_ansatte > 0
    THEN round(lr.driftsinntekter / e.antall_ansatte, 0)
  END AS omsetning_per_ansatt,
  CASE WHEN e.antall_ansatte IS NOT NULL AND e.antall_ansatte > 0
    THEN round(lr.driftsresultat / e.antall_ansatte, 0)
  END AS driftsresultat_per_ansatt,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN e.konkurs THEN 'konkurs'::text END,
    CASE WHEN e.under_avvikling THEN 'under_avvikling'::text END,
    CASE WHEN e.under_tvangsavvikling_eller_tvangsopplosning THEN 'under_tvangsavvikling'::text END,
    CASE WHEN lr.avviklingsregnskap THEN 'avviklingsregnskap'::text END,
    CASE WHEN lr.aarsresultat < 0 THEN 'negativt_aarsresultat'::text END,
    CASE WHEN lr.driftsresultat < 0 THEN 'negativt_driftsresultat'::text END,
    CASE WHEN lr.sum_egenkapital < 0 THEN 'negativ_egenkapital'::text END,
    CASE WHEN lr.fravalg_revisjon THEN 'fravalg_revisjon'::text END,
    CASE WHEN lr.ikke_revidert_aarsregnskap THEN 'ikke_revidert_aarsregnskap'::text END
  ], NULL) AS risiko_flags,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN lr.organisasjonsnummer IS NULL THEN 'mangler_regnskap'::text END,
    CASE WHEN e.antall_ansatte IS NULL THEN 'mangler_ansattall'::text END,
    CASE WHEN e.forretningsadresse_kommunenummer IS NULL THEN 'mangler_kommune'::text END,
    CASE WHEN e.naeringskode1_kode IS NULL THEN 'mangler_naeringskode'::text END
  ], NULL) AS datakvalitet_flags,
  c.ai_culture_score,
  c.ai_leadership_score,
  c.ai_work_environment_score,
  c.ai_career_development_score,
  c.ai_financial_stability_score,
  c.ai_mission_score,
  c.ai_overall_score,
  c.ai_rating_notes,
  c.ai_dimension_notes,
  c.financials,
  c.ai_rated_at,
  c.agg_culture_score,
  c.agg_leadership_score,
  c.agg_work_environment_score,
  c.agg_career_development_score,
  c.agg_financial_stability_score,
  c.agg_mission_score,
  c.agg_overall_score,
  c.agg_rating_count,
  s.status AS regnskap_sync_status,
  s.last_checked_at AS regnskap_last_checked_at,
  s.last_success_at AS regnskap_last_success_at,
  s.available_pdf_years
FROM reg.enheter e
LEFT JOIN latest_regnskap lr
  ON lr.organisasjonsnummer = e.organisasjonsnummer
LEFT JOIN reg.regnskap_sync_status s
  ON s.organisasjonsnummer = e.organisasjonsnummer
LEFT JOIN public.companies c
  ON c.organisasjonsnummer = e.organisasjonsnummer
WHERE coalesce(e.slettet, false) = false;

CREATE OR REPLACE FUNCTION public.search_employers(
  p_query                text    DEFAULT NULL,
  p_fylkesnummer         text    DEFAULT NULL,
  p_kommunenummer        text    DEFAULT NULL,
  p_naeringskode_prefix  text    DEFAULT NULL,
  p_min_ansatte          integer DEFAULT NULL,
  p_max_ansatte          integer DEFAULT NULL,
  p_min_omsetning        numeric DEFAULT NULL,
  p_max_omsetning        numeric DEFAULT NULL,
  p_arbeidsgiver_type    text    DEFAULT NULL,
  p_limit                integer DEFAULT 25,
  p_offset               integer DEFAULT 0,
  p_bransje_query        text    DEFAULT NULL,
  p_kommune_query        text    DEFAULT NULL
)
RETURNS SETOF public.employer_search_v1
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, reg
AS $$
  WITH params AS (
    SELECT
      nullif(trim(p_query), '')         AS q,
      regexp_replace(coalesce(p_query, ''), '\D', '', 'g') AS q_digits,
      nullif(trim(p_bransje_query), '') AS bq_raw,
      lower(nullif(trim(p_bransje_query), '')) AS bq,
      nullif(trim(p_kommune_query), '') AS kq,
      CASE
        WHEN nullif(trim(p_kommune_query), '') ~ '^[0-9]{1,4}$'
          THEN lpad(trim(p_kommune_query), 4, '0')
        ELSE NULL
      END AS kq_num,
      LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100) AS lim,
      GREATEST(COALESCE(p_offset, 0), 0) AS off
  ),
  bq_expanded AS (
    SELECT
      CASE
        WHEN params.bq IS NULL THEN NULL
        WHEN params.bq IN ('it','ikt','tech','teknologi')
          THEN ARRAY['it','ikt','informasjonsteknologi','programmering','programvare','databehandling','konsulent']
        WHEN params.bq IN ('bygg','anlegg','entreprenor','entreprenør','bygg og anlegg')
          THEN ARRAY['bygg','anlegg','entreprenør','bygging','oppføring']
        WHEN params.bq IN ('helse','omsorg','helse og omsorg')
          THEN ARRAY['helse','omsorg','sykehus','lege','pleie','sykehjem']
        WHEN params.bq IN ('regnskap','revisjon','økonomi','okonomi')
          THEN ARRAY['regnskap','revisjon','økonomi','bokføring']
        WHEN params.bq IN ('transport','logistikk')
          THEN ARRAY['transport','logistikk','gods','spedisjon','lager']
        WHEN params.bq IN ('energi','kraft','strøm','strom')
          THEN ARRAY['energi','kraft','strøm','elektrisitet','vind','vann']
        WHEN params.bq IN ('barnehage','skole','utdanning')
          THEN ARRAY['barnehage','skole','utdanning','undervisning']
        ELSE ARRAY[params.bq]
      END AS bq_terms,
      CASE
        WHEN params.bq IS NULL                                          THEN ARRAY[]::text[]
        WHEN params.bq IN ('it','ikt','tech','teknologi')               THEN ARRAY['62','63']
        WHEN params.bq IN ('bygg','anlegg','entreprenor','entreprenør') THEN ARRAY['41','42','43']
        WHEN params.bq IN ('helse','omsorg','helse og omsorg')          THEN ARRAY['86','87','88']
        WHEN params.bq IN ('regnskap','revisjon','økonomi','okonomi')   THEN ARRAY['69.20','69.2']
        WHEN params.bq IN ('transport','logistikk')                     THEN ARRAY['49','52','53']
        WHEN params.bq IN ('energi','kraft','strøm','strom')            THEN ARRAY['35']
        WHEN params.bq IN ('barnehage','skole','utdanning')             THEN ARRAY['85']
        ELSE ARRAY[]::text[]
      END AS bq_nace_prefixes
    FROM params
  ),
  candidate_enheter AS MATERIALIZED (
    SELECT
      e.*,
      CASE
        WHEN params.q IS NULL THEN 0
        WHEN e.organisasjonsnummer = params.q_digits THEN 2
        ELSE similarity(e.navn, params.q)
      END AS search_rank,
      CASE
        WHEN params.bq IS NULL THEN 0
        WHEN EXISTS (
          SELECT 1 FROM unnest(bq_expanded.bq_nace_prefixes) p
          WHERE e.naeringskode1_kode LIKE p || '%'
        ) THEN 1.0
        WHEN EXISTS (
          SELECT 1 FROM unnest(bq_expanded.bq_terms) t
          WHERE e.naeringskode1_beskrivelse ILIKE '%' || t || '%'
             OR e.naeringskode2_beskrivelse ILIKE '%' || t || '%'
             OR e.naeringskode3_beskrivelse ILIKE '%' || t || '%'
             OR e.aktivitet               ILIKE '%' || t || '%'
        ) THEN 0.9
        ELSE GREATEST(
          COALESCE(similarity(e.naeringskode1_beskrivelse, params.bq), 0),
          COALESCE(similarity(e.aktivitet,                 params.bq), 0)
        )
      END AS bransje_rank,
      CASE
        WHEN params.kq IS NULL THEN 0
        WHEN params.kq_num IS NOT NULL
          AND e.forretningsadresse_kommunenummer = params.kq_num THEN 1.0
        WHEN e.forretningsadresse_kommune ILIKE '%' || params.kq || '%' THEN 0.9
        ELSE COALESCE(similarity(e.forretningsadresse_kommune, params.kq), 0)
      END AS kommune_rank,
      params.lim,
      params.off
    FROM reg.enheter e
    CROSS JOIN params
    CROSS JOIN bq_expanded
    WHERE coalesce(e.slettet, false) = false
      AND (
        params.q IS NULL
        OR e.organisasjonsnummer = params.q_digits
        OR e.navn ILIKE '%' || params.q || '%'
      )
      AND (p_fylkesnummer IS NULL OR e.forretningsadresse_fylkesnummer = p_fylkesnummer)
      AND (p_kommunenummer IS NULL OR e.forretningsadresse_kommunenummer = p_kommunenummer)
      AND (p_naeringskode_prefix IS NULL OR e.naeringskode1_kode LIKE p_naeringskode_prefix || '%')
      AND (p_min_ansatte IS NULL OR e.antall_ansatte >= p_min_ansatte)
      AND (p_max_ansatte IS NULL OR e.antall_ansatte <= p_max_ansatte)
      AND (
        params.bq IS NULL
        OR EXISTS (
          SELECT 1 FROM unnest(bq_expanded.bq_terms) t
          WHERE e.naeringskode1_beskrivelse ILIKE '%' || t || '%'
             OR e.naeringskode2_beskrivelse ILIKE '%' || t || '%'
             OR e.naeringskode3_beskrivelse ILIKE '%' || t || '%'
             OR e.aktivitet               ILIKE '%' || t || '%'
        )
        OR similarity(e.naeringskode1_beskrivelse, params.bq) > 0.2
        OR similarity(e.aktivitet,                 params.bq) > 0.2
        OR EXISTS (
          SELECT 1 FROM unnest(bq_expanded.bq_nace_prefixes) p
          WHERE e.naeringskode1_kode LIKE p || '%'
        )
      )
      AND (
        params.kq IS NULL
        OR e.forretningsadresse_kommune ILIKE '%' || params.kq || '%'
        OR similarity(e.forretningsadresse_kommune, params.kq) > 0.2
        OR (params.kq_num IS NOT NULL
            AND e.forretningsadresse_kommunenummer = params.kq_num)
      )
    ORDER BY
      CASE
        WHEN params.q IS NULL THEN 0
        WHEN e.organisasjonsnummer = params.q_digits THEN 2
        ELSE similarity(e.navn, params.q)
      END DESC,
      e.antall_ansatte DESC NULLS LAST,
      e.navn ASC
    LIMIT 500
  )
  SELECT
    e.organisasjonsnummer,
    c.id AS company_id,
    e.navn,
    c.domain,
    e.organisasjonsform_kode,
    e.organisasjonsform_beskrivelse,
    e.naeringskode1_kode,
    e.naeringskode1_beskrivelse,
    e.naeringskode2_kode,
    e.naeringskode2_beskrivelse,
    e.naeringskode3_kode,
    e.naeringskode3_beskrivelse,
    e.antall_ansatte,
    CASE
      WHEN e.antall_ansatte IS NULL THEN 'ukjent'
      WHEN e.antall_ansatte = 0 THEN '0'
      WHEN e.antall_ansatte BETWEEN 1 AND 4 THEN '1-4'
      WHEN e.antall_ansatte BETWEEN 5 AND 19 THEN '5-19'
      WHEN e.antall_ansatte BETWEEN 20 AND 99 THEN '20-99'
      WHEN e.antall_ansatte BETWEEN 100 AND 499 THEN '100-499'
      ELSE '500+'
    END AS ansatte_bucket,
    e.har_registrert_antall_ansatte,
    e.forretningsadresse_poststed,
    e.forretningsadresse_postnummer,
    e.forretningsadresse_kommune,
    e.forretningsadresse_kommunenummer,
    e.forretningsadresse_fylkesnummer,
    e.forretningsadresse_fylke,
    e.hjemmeside,
    e.aktivitet,
    e.institusjonell_sektorkode,
    e.stiftelsesdato,
    CASE
      WHEN e.stiftelsesdato IS NULL THEN NULL
      ELSE date_part('year', age(current_date, e.stiftelsesdato))::int
    END AS selskapsalder_aar,
    e.registrert_i_foretaksregisteret,
    e.registrert_i_mvaregisteret,
    e.registrert_i_frivillighetsregisteret,
    e.er_i_konsern,
    e.overordnet_enhet,
    e.konkurs,
    e.under_avvikling,
    e.under_tvangsavvikling_eller_tvangsopplosning,
    e.slettet,
    e.er_offentlig,
    e.er_utdanning,
    e.er_rekruttering,
    CASE
      WHEN e.organisasjonsform_kode IN ('STAT', 'SF', 'HF') THEN 'statlig'
      WHEN e.organisasjonsform_kode IN ('KOMM', 'FYLK', 'KF', 'FKF', 'IKS') THEN 'kommunal_fylkeskommunal'
      WHEN e.er_offentlig THEN 'offentlig'
      WHEN e.organisasjonsform_kode IN ('FLI', 'STI') THEN 'ideell_stiftelse'
      ELSE 'privat'
    END AS arbeidsgiver_type,
    lr.regnskapsaar,
    lr.regnskapstype,
    lr.regnskapsperiode_fra,
    lr.regnskapsperiode_til,
    lr.driftsinntekter,
    lr.driftsresultat,
    lr.aarsresultat,
    lr.sum_egenkapital,
    lr.sum_gjeld,
    lr.sum_eiendeler,
    lr.sum_egenkapital_gjeld,
    lr.sum_omloepsmidler,
    lr.sum_anleggsmidler,
    lr.sum_driftskostnad,
    lr.sum_finansinntekter,
    lr.sum_finanskostnad,
    lr.valuta,
    lr.hentet_tidspunkt AS regnskap_hentet_tidspunkt,
    CASE
      WHEN lr.driftsinntekter IS NULL THEN 'ukjent'
      WHEN lr.driftsinntekter < 1000000 THEN '<1m'
      WHEN lr.driftsinntekter < 10000000 THEN '1-10m'
      WHEN lr.driftsinntekter < 50000000 THEN '10-50m'
      WHEN lr.driftsinntekter < 250000000 THEN '50-250m'
      ELSE '250m+'
    END AS omsetning_bucket,
    CASE WHEN lr.driftsinntekter IS NOT NULL AND lr.driftsinntekter <> 0
      THEN round((lr.driftsresultat / lr.driftsinntekter) * 100, 2)
    END AS driftsmargin_prosent,
    CASE WHEN lr.driftsinntekter IS NOT NULL AND lr.driftsinntekter <> 0
      THEN round((lr.aarsresultat / lr.driftsinntekter) * 100, 2)
    END AS aarsresultat_margin_prosent,
    CASE WHEN lr.sum_eiendeler IS NOT NULL AND lr.sum_eiendeler <> 0
      THEN round((lr.sum_egenkapital / lr.sum_eiendeler) * 100, 2)
    END AS egenkapitalandel_prosent,
    CASE WHEN lr.sum_egenkapital IS NOT NULL AND lr.sum_egenkapital <> 0
      THEN round(lr.sum_gjeld / lr.sum_egenkapital, 2)
    END AS gjeldsgrad,
    CASE WHEN e.antall_ansatte IS NOT NULL AND e.antall_ansatte > 0
      THEN round(lr.driftsinntekter / e.antall_ansatte, 0)
    END AS omsetning_per_ansatt,
    CASE WHEN e.antall_ansatte IS NOT NULL AND e.antall_ansatte > 0
      THEN round(lr.driftsresultat / e.antall_ansatte, 0)
    END AS driftsresultat_per_ansatt,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN e.konkurs THEN 'konkurs'::text END,
      CASE WHEN e.under_avvikling THEN 'under_avvikling'::text END,
      CASE WHEN e.under_tvangsavvikling_eller_tvangsopplosning THEN 'under_tvangsavvikling'::text END,
      CASE WHEN lr.avviklingsregnskap THEN 'avviklingsregnskap'::text END,
      CASE WHEN lr.aarsresultat < 0 THEN 'negativt_aarsresultat'::text END,
      CASE WHEN lr.driftsresultat < 0 THEN 'negativt_driftsresultat'::text END,
      CASE WHEN lr.sum_egenkapital < 0 THEN 'negativ_egenkapital'::text END,
      CASE WHEN lr.fravalg_revisjon THEN 'fravalg_revisjon'::text END,
      CASE WHEN lr.ikke_revidert_aarsregnskap THEN 'ikke_revidert_aarsregnskap'::text END
    ], NULL) AS risiko_flags,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN lr.organisasjonsnummer IS NULL THEN 'mangler_regnskap'::text END,
      CASE WHEN e.antall_ansatte IS NULL THEN 'mangler_ansattall'::text END,
      CASE WHEN e.forretningsadresse_kommunenummer IS NULL THEN 'mangler_kommune'::text END,
      CASE WHEN e.naeringskode1_kode IS NULL THEN 'mangler_naeringskode'::text END
    ], NULL) AS datakvalitet_flags,
    c.ai_culture_score,
    c.ai_leadership_score,
    c.ai_work_environment_score,
    c.ai_career_development_score,
    c.ai_financial_stability_score,
    c.ai_mission_score,
    c.ai_overall_score,
    c.ai_rating_notes,
    c.ai_dimension_notes,
    c.financials,
    c.ai_rated_at,
    c.agg_culture_score,
    c.agg_leadership_score,
    c.agg_work_environment_score,
    c.agg_career_development_score,
    c.agg_financial_stability_score,
    c.agg_mission_score,
    c.agg_overall_score,
    c.agg_rating_count,
    s.status AS regnskap_sync_status,
    s.last_checked_at AS regnskap_last_checked_at,
    s.last_success_at AS regnskap_last_success_at,
    s.available_pdf_years
  FROM candidate_enheter e
  LEFT JOIN LATERAL (
    SELECT *
    FROM reg.regnskap r
    WHERE r.organisasjonsnummer = e.organisasjonsnummer
    ORDER BY r.regnskapsaar DESC NULLS LAST,
      CASE WHEN r.regnskapstype = 'SELSKAP' THEN 0 ELSE 1 END,
      r.hentet_tidspunkt DESC NULLS LAST
    LIMIT 1
  ) lr ON true
  LEFT JOIN reg.regnskap_sync_status s
    ON s.organisasjonsnummer = e.organisasjonsnummer
  LEFT JOIN public.companies c
    ON c.organisasjonsnummer = e.organisasjonsnummer
  WHERE
    (p_min_omsetning IS NULL OR lr.driftsinntekter >= p_min_omsetning)
    AND (p_max_omsetning IS NULL OR lr.driftsinntekter <= p_max_omsetning)
    AND (
      p_arbeidsgiver_type IS NULL
      OR CASE
        WHEN e.organisasjonsform_kode IN ('STAT', 'SF', 'HF') THEN 'statlig'
        WHEN e.organisasjonsform_kode IN ('KOMM', 'FYLK', 'KF', 'FKF', 'IKS') THEN 'kommunal_fylkeskommunal'
        WHEN e.er_offentlig THEN 'offentlig'
        WHEN e.organisasjonsform_kode IN ('FLI', 'STI') THEN 'ideell_stiftelse'
        ELSE 'privat'
      END = p_arbeidsgiver_type
    )
    AND (
      (SELECT q FROM params) IS NULL
      OR c.domain ILIKE '%' || (SELECT q FROM params) || '%'
      OR e.search_rank > 0
    )
  ORDER BY
    e.search_rank   DESC,
    e.bransje_rank  DESC,
    e.kommune_rank  DESC,
    e.antall_ansatte DESC NULLS LAST,
    lr.driftsinntekter DESC NULLS LAST,
    e.navn ASC
  LIMIT  (SELECT lim FROM params)
  OFFSET (SELECT off FROM params);
$$;

COMMENT ON VIEW public.employer_search_v1 IS
  'Search-ready employer profile view combining Brreg enheter, latest Regnskapsregisteret figures, public.companies AI/aggregate scores, filters, risk flags, and calculated financial ratios.';

COMMENT ON FUNCTION public.search_employers(text, text, text, text, integer, integer, numeric, numeric, text, integer, integer, text, text) IS
  'RPC for employer search. Tekst-først bransje (p_bransje_query) og kommune (p_kommune_query) i tillegg til navn/orgnr (p_query), fylkesnummer, kommunenummer, NACE-prefix, ansatte, omsetning og arbeidsgivertype. Bruker ILIKE + pg_trgm + synonym-/alias-expansion for bransje, og ILIKE + trigram + kommunenummer-fallback for kommune.';