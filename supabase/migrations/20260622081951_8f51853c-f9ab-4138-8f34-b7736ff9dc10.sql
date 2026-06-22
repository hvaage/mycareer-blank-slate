CREATE OR REPLACE FUNCTION public.get_careerjet_sync_cron_info()
 RETURNS TABLE(jobname text, schedule text, active boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'cron', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
    SELECT j.jobname::text, j.schedule::text, j.active
    FROM cron.job j
    WHERE j.jobname LIKE 'careerjet-sync-%'
    ORDER BY j.jobname
    LIMIT 1;
END; $function$;

REVOKE ALL ON FUNCTION public.get_careerjet_sync_cron_info() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_careerjet_sync_cron_info() TO authenticated;