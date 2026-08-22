CREATE OR REPLACE FUNCTION public.network_sanitize_company_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT CASE
    WHEN coalesce(btrim(p_name), '') = '' THEN ''
    ELSE coalesce(
      nullif(
        btrim(
          regexp_replace(
            regexp_replace(btrim(p_name), '[[:space:]]*[-–—|,]?[[:space:]]*(https?://|www\.)[^[:space:]]+', '', 'gi'),
            '[[:space:],;:.–—|-]+$', '', 'g'
          )
        ), ''),
      btrim(p_name))
  END;
$$;

CREATE OR REPLACE FUNCTION public.network_company_name_is_junk(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT public.network_company_name_quality(public.network_sanitize_company_name(p_name))
         IN ('symbol_only', 'hashtag_promo', 'promotional');
$$;

GRANT EXECUTE ON FUNCTION public.network_sanitize_company_name(text) TO authenticated, service_role;