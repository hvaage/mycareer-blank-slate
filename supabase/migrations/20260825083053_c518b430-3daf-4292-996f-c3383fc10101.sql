-- S1-regresjon: åtte funksjoner var kallbare av anon i pg_proc.proacl,
-- i strid med migrasjonshistorikken. Strammes inn til authenticated + service_role.

REVOKE ALL ON FUNCTION public.delete_all_my_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_all_my_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_all_my_data() TO service_role;

REVOKE ALL ON FUNCTION public.cv_atomization_job_cancel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cv_atomization_job_cancel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cv_atomization_job_cancel(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.cv_atomization_job_resume(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cv_atomization_job_resume(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cv_atomization_job_resume(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.cv_review_set_role_choice(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cv_review_set_role_choice(uuid, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cv_review_set_role_choice(uuid, text, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.cv_review_promote_result(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cv_review_promote_result(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cv_review_promote_result(uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.network_company_reconciliation_scan(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_company_reconciliation_scan(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.network_company_reconciliation_scan(integer) TO service_role;

REVOKE ALL ON FUNCTION public.network_company_reconciliation_confirm(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_company_reconciliation_confirm(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.network_company_reconciliation_confirm(uuid, text, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.network_company_reconciliation_set_state(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_company_reconciliation_set_state(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.network_company_reconciliation_set_state(uuid, text) TO service_role;