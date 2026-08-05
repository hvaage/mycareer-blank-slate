DO $$
DECLARE r record; t0 timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO r FROM public.prune_cron_job_run_details(20000, 5000, 5);
  RAISE NOTICE 'prune max_runid=% prune_before=% deleted=% batches=% ms=%',
    r.max_runid, r.prune_before_runid, r.deleted_count, r.batches,
    round(extract(epoch from (clock_timestamp()-t0))*1000);
END $$;