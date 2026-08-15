ALTER TABLE reg.enheter_sok
  ADD COLUMN IF NOT EXISTS har_registrert_antall_ansatte boolean;

CREATE OR REPLACE FUNCTION reg.enheter_sok_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'reg', 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM reg.enheter_sok WHERE organisasjonsnummer = OLD.organisasjonsnummer;
    RETURN OLD;
  END IF;

  IF coalesce(NEW.slettet, false) THEN
    DELETE FROM reg.enheter_sok WHERE organisasjonsnummer = NEW.organisasjonsnummer;
    RETURN NEW;
  END IF;

  INSERT INTO reg.enheter_sok (organisasjonsnummer, navn, navn_norm, antall_ansatte, har_registrert_antall_ansatte)
  VALUES (NEW.organisasjonsnummer, NEW.navn, reg.sok_norm(NEW.navn), NEW.antall_ansatte, NEW.har_registrert_antall_ansatte)
  ON CONFLICT (organisasjonsnummer) DO UPDATE
    SET navn = EXCLUDED.navn,
        navn_norm = EXCLUDED.navn_norm,
        antall_ansatte = EXCLUDED.antall_ansatte,
        har_registrert_antall_ansatte = EXCLUDED.har_registrert_antall_ansatte;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enheter_sok_sync_upd ON reg.enheter;
CREATE TRIGGER trg_enheter_sok_sync_upd
AFTER UPDATE ON reg.enheter
FOR EACH ROW
WHEN (
  OLD.navn IS DISTINCT FROM NEW.navn
  OR OLD.antall_ansatte IS DISTINCT FROM NEW.antall_ansatte
  OR OLD.har_registrert_antall_ansatte IS DISTINCT FROM NEW.har_registrert_antall_ansatte
  OR coalesce(OLD.slettet, false) IS DISTINCT FROM coalesce(NEW.slettet, false)
)
EXECUTE FUNCTION reg.enheter_sok_sync();

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
  v_mirror boolean;
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

  v_mirror := (f->>'q') IS NOT NULL
    AND p_fylkesnummer IS NULL AND p_kommunenummer IS NULL
    AND p_naeringskode_prefix IS NULL
    AND p_min_omsetning IS NULL AND p_max_omsetning IS NULL
    AND p_arbeidsgiver_type IS NULL AND p_bransje_query IS NULL AND p_kommune_query IS NULL;

  IF v_mirror THEN
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
        SELECT m.antall_ansatte, m.har_registrert_antall_ansatte
        FROM reg.enheter_sok m
        WHERE (m.organisasjonsnummer = %L OR m.navn ILIKE %L)
        LIMIT %s
      ) t
    $q$, v_cap, v_cap, f->>'q_digits', '%' || (f->>'q') || '%', v_cap + 1)
    INTO v_res;
  ELSE
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
  END IF;

  RETURN v_res;
END;
$function$;

REVOKE ALL ON FUNCTION public.employer_ansatte_distribution(text,text,text,text,numeric,numeric,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employer_ansatte_distribution(text,text,text,text,numeric,numeric,text,text,text,integer) TO anon, authenticated, service_role;