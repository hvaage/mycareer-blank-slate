-- Employer detail read contract for the public Arbeidsgivere detail page.
--
-- The list/search flow already uses public.search_employers as a SECURITY
-- DEFINER RPC. The detail page must use the same pattern instead of selecting
-- public.employer_search_v1 directly, because that view is security_invoker and
-- ordinary users must not receive direct access to reg.* mirror tables.

CREATE OR REPLACE FUNCTION public.get_employer_detail(
  p_organisasjonsnummer text
)
RETURNS SETOF public.employer_search_v1
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, reg, pg_temp
ROWS 1
AS $$
  WITH normalized AS (
    SELECT regexp_replace(coalesce(p_organisasjonsnummer, ''), '\D', '', 'g') AS orgnr
  )
  SELECT v.*
  FROM normalized n
  JOIN public.employer_search_v1 v
    ON v.organisasjonsnummer = n.orgnr
  WHERE n.orgnr ~ '^[0-9]{9}$'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_employer_detail(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_employer_detail(text) FROM anon;
REVOKE ALL ON FUNCTION public.get_employer_detail(text) FROM authenticated;
REVOKE ALL ON FUNCTION public.get_employer_detail(text) FROM service_role;

GRANT EXECUTE ON FUNCTION public.get_employer_detail(text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_employer_detail(text) IS
  'Read-only SECURITY DEFINER employer detail lookup by organisation number. Keeps reg.* closed while allowing authenticated frontend detail pages to resolve employer_search_v1 rows.';
