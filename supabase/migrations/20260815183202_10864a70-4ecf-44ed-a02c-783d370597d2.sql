CREATE OR REPLACE FUNCTION public.get_employer_formaal(p_organisasjonsnummer text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'reg'
AS $function$
  SELECT e.vedtektsfestet_formaal
    FROM reg.enheter e
   WHERE e.organisasjonsnummer = regexp_replace(coalesce(p_organisasjonsnummer, ''), '\D', '', 'g')
   LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.get_employer_formaal(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_employer_formaal(text) TO anon, authenticated, service_role;