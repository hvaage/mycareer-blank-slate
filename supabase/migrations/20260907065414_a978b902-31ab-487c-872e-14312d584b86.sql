-- Ingen direkte anon-tilgang til Universum-funksjonene.
-- Offentlig visning skjer utelukkende via get_employer_analysis_view (SECURITY DEFINER).

REVOKE ALL ON FUNCTION public.get_universum_market_insight(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_universum_market_insight(text) TO service_role;

REVOKE ALL ON FUNCTION public.get_universum_source_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_universum_source_overview() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.universum_upsert_edition(text,text,text,integer,text,text,text,integer,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.universum_upsert_edition(text,text,text,integer,text,text,text,integer,text,jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.universum_replace_edition_entries(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.universum_replace_edition_entries(uuid, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.universum_normalize_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.universum_normalize_name(text) TO authenticated, service_role;