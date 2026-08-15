CREATE OR REPLACE FUNCTION public.employer_ansatte_distribution(
  p_query text DEFAULT NULL::text,
  p_fylkesnummer text DEFAULT NULL::text,
  p_kommunenummer text DEFAULT NULL::text,
  p_naeringskode_prefix text DEFAULT NULL::text,
  p_min_omsetning numeric DEFAULT NULL::numeric,
  p_max_omsetning numeric DEFAULT NULL::numeric,
  p_arbeidsgiver_type text DEFAULT NULL::text,
  p_bransje_query text DEFAULT NULL::text,
  p_kommune_query text DEFAULT NULL::text,
  p_cap integer DEFAULT 50000
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'reg'
SET statement_timeout TO '10s'
AS $function$
DECLARE
  f jsonb;
  v_cap int := LEAST(GREATEST(COALESCE(p_cap, 50000), 100), 50000);
  v_sample int := 5000;
  v_res jsonb;
  v_mirror boolean;
  v_src text;
  v_sql text;
BEGIN
  f := public._employer_filter_sql(
    p_query, p_fylkesnummer, p_kommunenummer, p_naeringskode_prefix,
    NULL, NULL, p_min_omsetning, p_max_omsetning,
    p_arbeidsgiver_type, p_bransje_query, p_kommune_query);

  IF (f->>'empty')::boolean THEN
    RETURN jsonb_build_object(
      'status', 'ok', 'utvalg', false,
      'fem_eller_flere', 0, 'null_til_fire', 0, 'ukjent', 0,
      'total', 0, 'capped', false, 'cap', v_cap, 'reason', f->>'reason');
  END IF;

  v_mirror := (f->>'q') IS NOT NULL
    AND p_fylkesnummer IS NULL AND p_kommunenummer IS NULL
    AND p_naeringskode_prefix IS NULL
    AND p_min_omsetning IS NULL AND p_max_omsetning IS NULL
    AND p_arbeidsgiver_type IS NULL AND p_bransje_query IS NULL AND p_kommune_query IS NULL;

  IF v_mirror THEN
    v_src := format(
      'SELECT m.antall_ansatte, m.har_registrert_antall_ansatte
         FROM reg.enheter_sok m
        WHERE (m.organisasjonsnummer = %L OR m.navn ILIKE %L)',
      f->>'q_digits', '%' || (f->>'q') || '%');
  ELSE
    v_src := format(
      'SELECT e.antall_ansatte, e.har_registrert_antall_ansatte
         FROM reg.enheter e %s %s %s',
      f->>'join', f->>'where', f->>'cand_add');
  END IF;

  v_sql := $q$
    SELECT jsonb_build_object(
      'fem_eller_flere', count(*) FILTER (WHERE t.antall_ansatte > 0),
      'null_til_fire', count(*) FILTER (WHERE t.har_registrert_antall_ansatte IS TRUE AND COALESCE(t.antall_ansatte, 0) = 0),
      'ukjent', count(*) FILTER (WHERE t.har_registrert_antall_ansatte IS NOT TRUE),
      'total', count(*)
    )
    FROM ( %s LIMIT %s ) t
  $q$;

  BEGIN
    PERFORM set_config('statement_timeout', '5s', true);
    EXECUTE format(v_sql, v_src, v_cap + 1) INTO v_res;
    PERFORM set_config('statement_timeout', '10s', true);
    RETURN v_res
      || jsonb_build_object(
           'status', 'ok',
           'utvalg', false,
           'capped', (v_res->>'total')::bigint > v_cap,
           'cap', v_cap);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    PERFORM set_config('statement_timeout', '3s', true);
    EXECUTE format(v_sql, v_src, v_sample) INTO v_res;
    PERFORM set_config('statement_timeout', '10s', true);
    RETURN v_res
      || jsonb_build_object(
           'status', 'utvalg',
           'utvalg', true,
           'utvalg_storrelse', v_sample,
           'capped', false,
           'cap', v_cap);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('statement_timeout', '10s', true);
    RETURN jsonb_build_object(
      'status', 'utilgjengelig',
      'utvalg', false,
      'fem_eller_flere', NULL, 'null_til_fire', NULL, 'ukjent', NULL,
      'total', NULL, 'capped', false, 'cap', v_cap,
      'reason', 'timeout');
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.employer_ansatte_distribution(text,text,text,text,numeric,numeric,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employer_ansatte_distribution(text,text,text,text,numeric,numeric,text,text,text,integer) TO anon, authenticated, service_role;