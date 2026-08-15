
CREATE OR REPLACE FUNCTION public.list_regnskap_cron_runs(p_limit integer DEFAULT 10)
 RETURNS TABLE(runid bigint, jobid bigint, jobname text, status text, return_message text, start_time timestamp with time zone, end_time timestamp with time zone, duration_ms integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'cron', 'pg_temp'
AS $function$
DECLARE
  v_limit integer := GREATEST(LEAST(COALESCE(p_limit, 10), 100), 1);
  v_window integer := GREATEST(v_limit * 100, 1000);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH recent AS (
    SELECT d.runid, d.jobid, d.status, d.return_message, d.start_time, d.end_time
    FROM cron.job_run_details d
    ORDER BY d.runid DESC
    LIMIT v_window
  )
  SELECT
    r.runid,
    r.jobid,
    j.jobname,
    r.status,
    r.return_message,
    r.start_time,
    r.end_time,
    CASE WHEN r.end_time IS NOT NULL AND r.start_time IS NOT NULL
         THEN (EXTRACT(EPOCH FROM (r.end_time - r.start_time)) * 1000)::integer
         ELSE NULL END AS duration_ms
  FROM recent r
  JOIN cron.job j ON j.jobid = r.jobid
  -- Begge navn: historikken før navnebyttet ligger på gammel jobid.
  WHERE j.jobname IN ('regnskap-sync-15min', 'regnskap-sync-nightly')
  ORDER BY r.runid DESC
  LIMIT v_limit;
END;
$function$;
