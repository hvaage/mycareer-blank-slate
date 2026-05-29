
REVOKE ALL ON FUNCTION public.register_lead(uuid, text, smallint, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_lead(uuid, text, smallint, text, text, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.prune_stale_leads(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prune_stale_leads(uuid) TO authenticated, service_role;
