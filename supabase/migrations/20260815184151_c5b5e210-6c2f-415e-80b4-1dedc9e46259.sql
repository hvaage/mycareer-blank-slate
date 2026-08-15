CREATE OR REPLACE FUNCTION public.get_employer_regnskap_history(p_organisasjonsnummer text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, reg
SET statement_timeout = '10s'
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'regnskapsaar', r.regnskapsaar,
        'regnskapstype', r.regnskapstype,
        'driftsinntekter', r.driftsinntekter,
        'driftsresultat', r.driftsresultat,
        'aarsresultat', r.aarsresultat,
        'sum_egenkapital', r.sum_egenkapital,
        'valuta', r.valuta
      )
      ORDER BY r.regnskapsaar DESC
    ),
    '[]'::jsonb
  )
  FROM reg.regnskap r
  WHERE r.organisasjonsnummer = regexp_replace(COALESCE(p_organisasjonsnummer, ''), '\D', '', 'g')
    AND r.regnskapsaar IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_employer_regnskap_history(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_employer_regnskap_history(text) TO anon, authenticated, service_role;