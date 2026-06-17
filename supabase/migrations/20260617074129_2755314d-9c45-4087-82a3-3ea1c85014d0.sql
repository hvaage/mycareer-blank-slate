-- M5.5: Nightly cron schedule for regnskap-sync.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Admin-only RPC for cron delivery oversight.
CREATE OR REPLACE FUNCTION public.list_regnskap_cron_runs(p_limit integer DEFAULT 10)
RETURNS TABLE(
  runid bigint,
  jobid bigint,
  jobname text,
  status text,
  return_message text,
  start_time timestamptz,
  end_time timestamptz,
  duration_ms integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, cron, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    d.runid,
    d.jobid,
    j.jobname,
    d.status,
    d.return_message,
    d.start_time,
    d.end_time,
    CASE WHEN d.end_time IS NOT NULL AND d.start_time IS NOT NULL
         THEN (EXTRACT(EPOCH FROM (d.end_time - d.start_time)) * 1000)::integer
         ELSE NULL END AS duration_ms
  FROM cron.job_run_details d
  JOIN cron.job j ON j.jobid = d.jobid
  WHERE j.jobname = 'regnskap-sync-nightly'
  ORDER BY d.start_time DESC NULLS LAST
  LIMIT GREATEST(LEAST(COALESCE(p_limit, 10), 100), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.list_regnskap_cron_runs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_regnskap_cron_runs(integer) TO authenticated;

-- Idempotent schedule.
DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'regnskap-sync-nightly';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule('regnskap-sync-nightly');
  END IF;
END $$;

SELECT cron.schedule(
  'regnskap-sync-nightly',
  '0 3 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://miwzhbludgwvskmsfqnq.supabase.co/functions/v1/regnskap-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'regnskap_sync_cron_secret')
    ),
    body := '{"op":"run","mode":"due","limit":20,"rps":0.5,"timeBudgetMs":50000}'::jsonb
  ) AS request_id;
  $job$
);