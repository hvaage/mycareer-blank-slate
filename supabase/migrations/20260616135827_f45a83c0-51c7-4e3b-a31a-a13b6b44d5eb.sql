CREATE OR REPLACE FUNCTION public.search_employers(
  p_query text DEFAULT NULL::text,
  p_fylkesnummer text DEFAULT NULL::text,
  p_kommunenummer text DEFAULT NULL::text,
  p_naeringskode_prefix text DEFAULT NULL::text,
  p_min_ansatte integer DEFAULT NULL::integer,
  p_max_ansatte integer DEFAULT NULL::integer,
  p_min_omsetning numeric DEFAULT NULL::numeric,
  p_max_omsetning numeric DEFAULT NULL::numeric,
  p_arbeidsgiver_type text DEFAULT NULL::text,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_bransje_query text DEFAULT NULL::text,
  p_kommune_query text DEFAULT NULL::text
)
RETURNS SETOF employer_search_v1
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'reg'
AS $function$
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
        ELSE 0
      END AS bransje_rank,
      CASE
        WHEN params.kq IS NULL THEN 0
        WHEN params.kq_num IS NOT NULL
          AND e.forretningsadresse_kommunenummer = params.kq_num THEN 1.0
        WHEN e.forretningsadresse_kommune ILIKE '%' || params.kq || '%' THEN 0.9
        ELSE 0
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
      -- Bransje WHERE: bare index-vennlige greiner (nace-prefiks + ILIKE på beskrivelse/aktivitet).
      -- similarity() er beholdt i ranking, ikke i WHERE, for å unngå seq scan på 440k rader.
      AND (
        params.bq IS NULL
        OR EXISTS (
          SELECT 1 FROM unnest(bq_expanded.bq_nace_prefixes) p
          WHERE e.naeringskode1_kode LIKE p || '%'
        )
        OR EXISTS (
          SELECT 1 FROM unnest(bq_expanded.bq_terms) t
          WHERE e.naeringskode1_beskrivelse ILIKE '%' || t || '%'
             OR e.naeringskode2_beskrivelse ILIKE '%' || t || '%'
             OR e.naeringskode3_beskrivelse ILIKE '%' || t || '%'
             OR e.aktivitet               ILIKE '%' || t || '%'
        )
      )
      -- Kommune WHERE: ILIKE eller eksakt kommunenummer (begge indeksvennlige).
      AND (
        params.kq IS NULL
        OR e.forretningsadresse_kommune ILIKE '%' || params.kq || '%'
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
$function$;

GRANT EXECUTE ON FUNCTION public.search_employers(text,text,text,text,integer,integer,numeric,numeric,text,integer,integer,text,text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';