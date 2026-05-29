
REVOKE ALL ON FUNCTION public.get_user_employers(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refresh_company_aggregate(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refresh_company_process_aggregate(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_lead(uuid, text, smallint, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_employers(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_company_aggregate(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_company_process_aggregate(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_lead(uuid, text, smallint, text, text, uuid) TO authenticated;
