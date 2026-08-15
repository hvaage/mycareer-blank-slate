CREATE OR REPLACE FUNCTION public._employer_filter_sql(p_query text DEFAULT NULL::text, p_fylkesnummer text DEFAULT NULL::text, p_kommunenummer text DEFAULT NULL::text, p_naeringskode_prefix text DEFAULT NULL::text, p_min_ansatte integer DEFAULT NULL::integer, p_max_ansatte integer DEFAULT NULL::integer, p_min_omsetning numeric DEFAULT NULL::numeric, p_max_omsetning numeric DEFAULT NULL::numeric, p_arbeidsgiver_type text DEFAULT NULL::text, p_bransje_query text DEFAULT NULL::text, p_kommune_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'reg'
AS $function$
DECLARE
  v_q              text := nullif(btrim(p_query), '');
  v_q_digits       text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
  v_bq             text := lower(nullif(btrim(p_bransje_query), ''));
  v_kq             text := nullif(btrim(p_kommune_query), '');
  v_nace_prefixes  text[] := ARRAY[]::text[];
  v_text_terms     text[] := ARRAY[]::text[];
  v_kommunenrs     text[] := NULL;
  v_where          text := ' WHERE coalesce(e.slettet,false)=false ';
  v_cand_join      text := '';
  v_cand_where_add text := '';
  v_in_list        text;
BEGIN
  -- Punkt 4: minste søkelengde er 3 tegn. Ingen navn i registeret er kortere enn 3.
  IF v_q IS NOT NULL AND length(v_q) < 3 THEN
    RETURN jsonb_build_object('empty', true, 'reason', 'min_query_length');
  END IF;

  IF v_bq IS NOT NULL THEN
    IF v_bq IN ('it','ikt','tech','teknologi') THEN
      v_nace_prefixes := ARRAY['62','63'];
      v_text_terms    := ARRAY['informasjonsteknologi','kommunikasjonsteknologi'];
    ELSIF v_bq IN ('bygg','anlegg','entreprenor','entreprenør','bygg og anlegg') THEN
      v_nace_prefixes := ARRAY['41','42','43'];
      v_text_terms    := ARRAY['entreprenør','byggmester'];
    ELSIF v_bq IN ('helse','omsorg','helse og omsorg') THEN
      v_nace_prefixes := ARRAY['86','87','88'];
      v_text_terms    := ARRAY['sykehus','sykehjem'];
    ELSIF v_bq IN ('regnskap','revisjon','økonomi','okonomi') THEN
      v_nace_prefixes := ARRAY['69.20','69.2'];
      v_text_terms    := ARRAY['regnskap','revisjon'];
    ELSIF v_bq IN ('transport','logistikk') THEN
      v_nace_prefixes := ARRAY['49','52','53'];
      v_text_terms    := ARRAY['spedisjon'];
    ELSIF v_bq IN ('energi','kraft','strøm','strom') THEN
      v_nace_prefixes := ARRAY['35'];
      v_text_terms    := ARRAY['elektrisitet'];
    ELSIF v_bq IN ('barnehage','skole','utdanning') THEN
      v_nace_prefixes := ARRAY['85'];
      v_text_terms    := ARRAY['undervisning'];
    ELSIF length(v_bq) >= 3 THEN
      v_text_terms := ARRAY[v_bq];
    ELSE
      v_text_terms := ARRAY[]::text[];
    END IF;
  END IF;

  IF v_kq IS NOT NULL THEN
    IF v_kq ~ '^[0-9]{1,4}$' THEN
      v_kommunenrs := ARRAY[lpad(v_kq, 4, '0')];
    ELSE
      SELECT array_agg(kommunenummer) INTO v_kommunenrs
        FROM reg.kommune_fylke
       WHERE lower(kommunenavn) LIKE lower(v_kq) || '%';
      IF v_kommunenrs IS NULL OR array_length(v_kommunenrs,1) IS NULL THEN
        RETURN jsonb_build_object('empty', true);
      END IF;
    END IF;
  END IF;

  IF v_q IS NOT NULL THEN
    v_where := v_where || format(
      ' AND (e.organisasjonsnummer = %L OR e.navn ILIKE %L) ',
      v_q_digits, '%' || v_q || '%'
    );
  END IF;
  IF p_fylkesnummer IS NOT NULL THEN
    v_where := v_where || format(' AND e.forretningsadresse_fylkesnummer = %L ', p_fylkesnummer);
  END IF;
  IF p_kommunenummer IS NOT NULL THEN
    v_where := v_where || format(' AND e.forretningsadresse_kommunenummer = %L ', p_kommunenummer);
  END IF;

  IF v_kommunenrs IS NOT NULL AND array_length(v_kommunenrs, 1) IS NOT NULL THEN
    SELECT string_agg(quote_literal(x), ',') INTO v_in_list FROM unnest(v_kommunenrs) AS x;
    IF v_in_list IS NOT NULL AND v_in_list <> '' THEN
      v_where := v_where || ' AND e.forretningsadresse_kommunenummer IN (' || v_in_list || ') ';
    ELSE
      v_where := v_where || ' AND false ';
    END IF;
  END IF;

  IF p_naeringskode_prefix IS NOT NULL THEN
    v_where := v_where || format(' AND e.naeringskode1_kode LIKE %L ', p_naeringskode_prefix || '%');
  END IF;
  IF p_min_ansatte IS NOT NULL THEN
    v_where := v_where || format(' AND e.antall_ansatte >= %s ', p_min_ansatte);
  END IF;
  IF p_max_ansatte IS NOT NULL THEN
    v_where := v_where || format(' AND e.antall_ansatte <= %s ', p_max_ansatte);
  END IF;

  IF v_bq IS NOT NULL THEN
    DECLARE
      v_parts text[] := ARRAY[]::text[];
      p text; t text;
    BEGIN
      FOREACH p IN ARRAY v_nace_prefixes LOOP
        v_parts := v_parts || format('e.naeringskode1_kode LIKE %L', p || '%');
      END LOOP;
      FOREACH t IN ARRAY v_text_terms LOOP
        IF length(t) >= 3 THEN
          v_parts := v_parts || format(
            '(e.naeringskode1_beskrivelse ILIKE %1$L OR e.naeringskode2_beskrivelse ILIKE %1$L OR e.naeringskode3_beskrivelse ILIKE %1$L OR e.aktivitet ILIKE %1$L)',
            '%' || t || '%'
          );
        END IF;
      END LOOP;
      IF array_length(v_parts,1) IS NULL THEN
        RETURN jsonb_build_object('empty', true);
      END IF;
      v_where := v_where || ' AND (' || array_to_string(v_parts, ' OR ') || ') ';
    END;
  END IF;

  IF p_arbeidsgiver_type IS NOT NULL THEN
    v_where := v_where || format(
      ' AND CASE
          WHEN e.organisasjonsform_kode IN (''STAT'',''SF'',''HF'') THEN ''statlig''
          WHEN e.organisasjonsform_kode IN (''KOMM'',''FYLK'',''KF'',''FKF'',''IKS'') THEN ''kommunal_fylkeskommunal''
          WHEN e.er_offentlig THEN ''offentlig''
          WHEN e.organisasjonsform_kode IN (''FLI'',''STI'') THEN ''ideell_stiftelse''
          ELSE ''privat''
        END = %L ', p_arbeidsgiver_type
    );
  END IF;

  IF p_min_omsetning IS NOT NULL OR p_max_omsetning IS NOT NULL THEN
    v_cand_join := ' JOIN reg.regnskap_siste_per_org lr0 ON lr0.organisasjonsnummer = e.organisasjonsnummer ';
    IF p_min_omsetning IS NOT NULL THEN
      v_cand_where_add := v_cand_where_add || format(' AND lr0.driftsinntekter >= %s ', p_min_omsetning);
    END IF;
    IF p_max_omsetning IS NOT NULL THEN
      v_cand_where_add := v_cand_where_add || format(' AND lr0.driftsinntekter <= %s ', p_max_omsetning);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'empty', false,
    'join', v_cand_join,
    'where', v_where,
    'cand_add', v_cand_where_add,
    'q', v_q,
    'q_digits', v_q_digits
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.count_employers(p_query text DEFAULT NULL::text, p_fylkesnummer text DEFAULT NULL::text, p_kommunenummer text DEFAULT NULL::text, p_naeringskode_prefix text DEFAULT NULL::text, p_min_ansatte integer DEFAULT NULL::integer, p_max_ansatte integer DEFAULT NULL::integer, p_min_omsetning numeric DEFAULT NULL::numeric, p_max_omsetning numeric DEFAULT NULL::numeric, p_arbeidsgiver_type text DEFAULT NULL::text, p_bransje_query text DEFAULT NULL::text, p_kommune_query text DEFAULT NULL::text, p_cap integer DEFAULT 50000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'reg'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  f jsonb;
  v_cap int := LEAST(GREATEST(COALESCE(p_cap, 50000), 100), 50000);
  v_n bigint;
  v_mirror boolean;
BEGIN
  f := public._employer_filter_sql(
    p_query, p_fylkesnummer, p_kommunenummer, p_naeringskode_prefix,
    p_min_ansatte, p_max_ansatte, p_min_omsetning, p_max_omsetning,
    p_arbeidsgiver_type, p_bransje_query, p_kommune_query);

  IF (f->>'empty')::boolean THEN
    RETURN jsonb_build_object('total_count', 0, 'is_estimate', false, 'capped', false, 'cap', v_cap, 'reason', f->>'reason');
  END IF;

  v_mirror := (f->>'q') IS NOT NULL
    AND p_fylkesnummer IS NULL AND p_kommunenummer IS NULL
    AND p_naeringskode_prefix IS NULL AND p_min_ansatte IS NULL AND p_max_ansatte IS NULL
    AND p_min_omsetning IS NULL AND p_max_omsetning IS NULL
    AND p_arbeidsgiver_type IS NULL AND p_bransje_query IS NULL AND p_kommune_query IS NULL;

  IF v_mirror THEN
    EXECUTE format(
      'SELECT count(*) FROM (SELECT 1 FROM reg.enheter_sok m WHERE (m.organisasjonsnummer = %L OR m.navn ILIKE %L) LIMIT %s) t',
      f->>'q_digits', '%' || (f->>'q') || '%', v_cap + 1
    ) INTO v_n;
  ELSE
    EXECUTE format(
      'SELECT count(*) FROM (SELECT 1 FROM reg.enheter e %s %s %s LIMIT %s) t',
      f->>'join', f->>'where', f->>'cand_add', v_cap + 1
    ) INTO v_n;
  END IF;

  IF v_n <= v_cap THEN
    RETURN jsonb_build_object('total_count', v_n, 'is_estimate', false, 'capped', false, 'cap', v_cap);
  END IF;

  -- Over taket: ingen estimat. Planestimatet bommet med 84 prosent (49 650 mot 26 910),
  -- og et tall som later som det er talt er verre enn ingen tall.
  RETURN jsonb_build_object('total_count', v_cap, 'is_estimate', false, 'capped', true, 'cap', v_cap);
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_employers(p_query text DEFAULT NULL::text, p_fylkesnummer text DEFAULT NULL::text, p_kommunenummer text DEFAULT NULL::text, p_naeringskode_prefix text DEFAULT NULL::text, p_min_ansatte integer DEFAULT NULL::integer, p_max_ansatte integer DEFAULT NULL::integer, p_min_omsetning numeric DEFAULT NULL::numeric, p_max_omsetning numeric DEFAULT NULL::numeric, p_arbeidsgiver_type text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_bransje_query text DEFAULT NULL::text, p_kommune_query text DEFAULT NULL::text)
 RETURNS SETOF employer_search_v1
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'reg'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  f        jsonb;
  v_lim    int := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_off    int := GREATEST(COALESCE(p_offset, 0), 0);
  v_q      text;
  v_qd     text;
  v_rank   text;
  v_ql     text;
  v_tier_e text;
  v_tier_m text;
  v_cand   text;
  v_mirror boolean;
  v_sql    text;
BEGIN
  f := public._employer_filter_sql(
    p_query, p_fylkesnummer, p_kommunenummer, p_naeringskode_prefix,
    p_min_ansatte, p_max_ansatte, p_min_omsetning, p_max_omsetning,
    p_arbeidsgiver_type, p_bransje_query, p_kommune_query);

  IF (f->>'empty')::boolean THEN
    RETURN;
  END IF;

  v_q  := f->>'q';
  v_qd := f->>'q_digits';
  v_ql := lower(v_q);
  v_tier_e := CASE WHEN v_q IS NULL THEN NULL ELSE
      'CASE WHEN e.organisasjonsnummer = ' || quote_literal(v_qd) || ' THEN 5'
    || ' WHEN lower(e.navn) = ' || quote_literal(v_ql) || ' THEN 4'
    || ' WHEN reg.sok_norm(e.navn) = ' || quote_literal(reg.sok_norm(v_q)) || ' THEN 4'
    || ' WHEN lower(e.navn) LIKE ' || quote_literal(v_ql || '%') || ' THEN 3'
    || ' WHEN lower(e.navn) LIKE ' || quote_literal('% ' || v_ql || '%') || ' THEN 2'
    || ' ELSE 1 END' END;
  v_tier_m := CASE WHEN v_q IS NULL THEN NULL ELSE
      'CASE WHEN m.organisasjonsnummer = ' || quote_literal(v_qd) || ' THEN 5'
    || ' WHEN lower(m.navn) = ' || quote_literal(v_ql) || ' THEN 4'
    || ' WHEN m.navn_norm = ' || quote_literal(reg.sok_norm(v_q)) || ' THEN 4'
    || ' WHEN lower(m.navn) LIKE ' || quote_literal(v_ql || '%') || ' THEN 3'
    || ' WHEN lower(m.navn) LIKE ' || quote_literal('% ' || v_ql || '%') || ' THEN 2'
    || ' ELSE 1 END' END;
  -- Rangering: etasje først (eksakt navn/orgnr øverst), størrelse som sekundærkriterium
  -- innenfor samme etasje, similarity kun som tredje signal.
  v_rank := CASE WHEN v_q IS NOT NULL
    THEN v_tier_e || ' DESC, e.antall_ansatte DESC NULLS LAST, similarity(e.navn, ' || quote_literal(v_q) || ') DESC,'
    ELSE '' END;

  v_mirror := v_q IS NOT NULL
    AND p_fylkesnummer IS NULL AND p_kommunenummer IS NULL
    AND p_naeringskode_prefix IS NULL AND p_min_ansatte IS NULL AND p_max_ansatte IS NULL
    AND p_min_omsetning IS NULL AND p_max_omsetning IS NULL
    AND p_arbeidsgiver_type IS NULL AND p_bransje_query IS NULL AND p_kommune_query IS NULL;

  IF v_mirror THEN
    v_cand := format($c$
      SELECT m.organisasjonsnummer
      FROM reg.enheter_sok m
      WHERE (m.organisasjonsnummer = %L OR m.navn ILIKE %L)
      ORDER BY
        %s DESC,
        m.antall_ansatte DESC NULLS LAST,
        similarity(m.navn, %L) DESC,
        m.navn ASC
      LIMIT %s
    $c$, v_qd, '%' || v_q || '%', v_tier_m, v_q, v_off + v_lim);
  ELSE
    v_cand := format($c$
      SELECT e.organisasjonsnummer
      FROM reg.enheter e
      %s
      %s %s
      ORDER BY
        %s
        e.antall_ansatte DESC NULLS LAST,
        e.navn ASC
      LIMIT %s
    $c$, f->>'join', f->>'where', f->>'cand_add', v_rank, v_off + v_lim);
  END IF;

  v_sql := format($q$
    WITH cand AS MATERIALIZED (
      %s
    )
    SELECT
      e.organisasjonsnummer, c.id, e.navn, c.domain,
      e.organisasjonsform_kode, e.organisasjonsform_beskrivelse,
      e.naeringskode1_kode, e.naeringskode1_beskrivelse,
      e.naeringskode2_kode, e.naeringskode2_beskrivelse,
      e.naeringskode3_kode, e.naeringskode3_beskrivelse,
      e.antall_ansatte,
      CASE
        WHEN e.antall_ansatte IS NULL THEN 'ukjent'
        WHEN e.antall_ansatte = 0 THEN '0'
        WHEN e.antall_ansatte BETWEEN 1 AND 4 THEN '1-4'
        WHEN e.antall_ansatte BETWEEN 5 AND 19 THEN '5-19'
        WHEN e.antall_ansatte BETWEEN 20 AND 99 THEN '20-99'
        WHEN e.antall_ansatte BETWEEN 100 AND 499 THEN '100-499'
        ELSE '500+' END,
      e.har_registrert_antall_ansatte,
      e.forretningsadresse_poststed, e.forretningsadresse_postnummer,
      e.forretningsadresse_kommune, e.forretningsadresse_kommunenummer,
      e.forretningsadresse_fylkesnummer, e.forretningsadresse_fylke,
      e.hjemmeside, e.aktivitet, e.institusjonell_sektorkode,
      e.stiftelsesdato,
      CASE WHEN e.stiftelsesdato IS NULL THEN NULL
           ELSE date_part('year', age(current_date, e.stiftelsesdato))::int END,
      e.registrert_i_foretaksregisteret, e.registrert_i_mvaregisteret,
      e.registrert_i_frivillighetsregisteret, e.er_i_konsern, e.overordnet_enhet,
      e.konkurs, e.under_avvikling, e.under_tvangsavvikling_eller_tvangsopplosning,
      e.slettet, e.er_offentlig, e.er_utdanning, e.er_rekruttering,
      CASE
        WHEN e.organisasjonsform_kode IN ('STAT','SF','HF') THEN 'statlig'
        WHEN e.organisasjonsform_kode IN ('KOMM','FYLK','KF','FKF','IKS') THEN 'kommunal_fylkeskommunal'
        WHEN e.er_offentlig THEN 'offentlig'
        WHEN e.organisasjonsform_kode IN ('FLI','STI') THEN 'ideell_stiftelse'
        ELSE 'privat' END,
      lr.regnskapsaar, lr.regnskapstype, lr.regnskapsperiode_fra, lr.regnskapsperiode_til,
      lr.driftsinntekter, lr.driftsresultat, lr.aarsresultat,
      lr.sum_egenkapital, lr.sum_gjeld, lr.sum_eiendeler, lr.sum_egenkapital_gjeld,
      lr.sum_omloepsmidler, lr.sum_anleggsmidler, lr.sum_driftskostnad,
      lr.sum_finansinntekter, lr.sum_finanskostnad, lr.valuta, lr.hentet_tidspunkt,
      CASE
        WHEN lr.driftsinntekter IS NULL THEN 'ukjent'
        WHEN lr.driftsinntekter < 1000000 THEN '<1m'
        WHEN lr.driftsinntekter < 10000000 THEN '1-10m'
        WHEN lr.driftsinntekter < 50000000 THEN '10-50m'
        WHEN lr.driftsinntekter < 250000000 THEN '50-250m'
        ELSE '250m+' END,
      CASE WHEN lr.driftsinntekter IS NOT NULL AND lr.driftsinntekter <> 0
           THEN round((lr.driftsresultat / lr.driftsinntekter) * 100, 2) END,
      CASE WHEN lr.driftsinntekter IS NOT NULL AND lr.driftsinntekter <> 0
           THEN round((lr.aarsresultat / lr.driftsinntekter) * 100, 2) END,
      CASE WHEN lr.sum_eiendeler IS NOT NULL AND lr.sum_eiendeler <> 0
           THEN round((lr.sum_egenkapital / lr.sum_eiendeler) * 100, 2) END,
      CASE WHEN lr.sum_egenkapital IS NOT NULL AND lr.sum_egenkapital <> 0
           THEN round(lr.sum_gjeld / lr.sum_egenkapital, 2) END,
      CASE WHEN e.antall_ansatte IS NOT NULL AND e.antall_ansatte > 0
           THEN round(lr.driftsinntekter / e.antall_ansatte, 0) END,
      CASE WHEN e.antall_ansatte IS NOT NULL AND e.antall_ansatte > 0
           THEN round(lr.driftsresultat / e.antall_ansatte, 0) END,
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
      ], NULL),
      ARRAY_REMOVE(ARRAY[
        CASE WHEN lr.organisasjonsnummer IS NULL THEN 'mangler_regnskap'::text END,
        CASE WHEN e.antall_ansatte IS NULL THEN 'mangler_ansattall'::text END,
        CASE WHEN e.forretningsadresse_kommunenummer IS NULL THEN 'mangler_kommune'::text END,
        CASE WHEN e.naeringskode1_kode IS NULL THEN 'mangler_naeringskode'::text END
      ], NULL),
      c.ai_culture_score, c.ai_leadership_score, c.ai_work_environment_score,
      c.ai_career_development_score, c.ai_financial_stability_score, c.ai_mission_score,
      c.ai_overall_score, c.ai_rating_notes, c.ai_dimension_notes, c.financials, c.ai_rated_at,
      c.agg_culture_score, c.agg_leadership_score, c.agg_work_environment_score,
      c.agg_career_development_score, c.agg_financial_stability_score, c.agg_mission_score,
      c.agg_overall_score, c.agg_rating_count,
      s.status, s.last_checked_at, s.last_success_at, s.available_pdf_years
    FROM cand
    JOIN reg.enheter e ON e.organisasjonsnummer = cand.organisasjonsnummer
    LEFT JOIN reg.regnskap_siste_per_org lr ON lr.organisasjonsnummer = e.organisasjonsnummer
    LEFT JOIN reg.regnskap_sync_status s ON s.organisasjonsnummer = e.organisasjonsnummer
    LEFT JOIN public.companies c ON c.organisasjonsnummer = e.organisasjonsnummer
    ORDER BY
      %s
      e.antall_ansatte DESC NULLS LAST,
      lr.driftsinntekter DESC NULLS LAST,
      e.navn ASC
    LIMIT %s OFFSET %s
  $q$, v_cand, v_rank, v_lim, v_off);

  RETURN QUERY EXECUTE v_sql;
END;
$function$;