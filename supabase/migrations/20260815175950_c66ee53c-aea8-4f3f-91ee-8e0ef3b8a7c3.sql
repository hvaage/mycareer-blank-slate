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
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'reg'
SET statement_timeout TO '10s'
AS $function$
DECLARE
  f jsonb;
  v_cap int := LEAST(GREATEST(COALESCE(p_cap, 50000), 100), 50000);
  v_res jsonb;
BEGIN
  f := public._employer_filter_sql(
    p_query, p_fylkesnummer, p_kommunenummer, p_naeringskode_prefix,
    NULL, NULL, p_min_omsetning, p_max_omsetning,
    p_arbeidsgiver_type, p_bransje_query, p_kommune_query);

  IF (f->>'empty')::boolean THEN
    RETURN jsonb_build_object(
      'fem_eller_flere', 0, 'null_til_fire', 0, 'ukjent', 0,
      'total', 0, 'capped', false, 'cap', v_cap, 'reason', f->>'reason');
  END IF;

  EXECUTE format($q$
    SELECT jsonb_build_object(
      'fem_eller_flere', count(*) FILTER (WHERE t.antall_ansatte > 0),
      'null_til_fire', count(*) FILTER (WHERE t.har_registrert_antall_ansatte IS TRUE AND COALESCE(t.antall_ansatte, 0) = 0),
      'ukjent', count(*) FILTER (WHERE t.har_registrert_antall_ansatte IS NOT TRUE),
      'total', count(*),
      'capped', count(*) > %s,
      'cap', %s
    )
    FROM (
      SELECT e.antall_ansatte, e.har_registrert_antall_ansatte
      FROM reg.enheter e %s %s %s
      LIMIT %s
    ) t
  $q$, v_cap, v_cap, f->>'join', f->>'where', f->>'cand_add', v_cap + 1)
  INTO v_res;

  RETURN v_res;
END;
$function$;

REVOKE ALL ON FUNCTION public.employer_ansatte_distribution(text,text,text,text,numeric,numeric,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employer_ansatte_distribution(text,text,text,text,numeric,numeric,text,text,text,integer) TO anon, authenticated, service_role;