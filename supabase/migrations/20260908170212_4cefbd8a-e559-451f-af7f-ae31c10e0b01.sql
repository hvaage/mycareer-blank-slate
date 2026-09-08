DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname IN (
    'network-suggestions-worker-1min','network-suggestions-reaper-5min',
    'regnskap-sync-15min','brreg-enheter-full-driver','nav-sync-30min')
  LOOP
    PERFORM cron.alter_job(job_id := r.jobid, active := false);
  END LOOP;
END $$;