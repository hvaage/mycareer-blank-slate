-- cron.job_run_details maintenance runbook.
--
-- Context:
-- pg_cron records every job run in cron.job_run_details and does not clean it
-- automatically. On the Lovable-managed target this table reached ~2 GB and
-- started making pg_cron delivery diagnostics and startup unstable.
--
-- Safety:
-- - This only touches operational pg_cron history, never application data.
-- - Keep the newest runids; prune old history in bounded batches.
-- - Do not run VACUUM FULL through Lovable Cloud.
-- - Stop once cron delivery is stable enough for observation.

-- 1. Health snapshot. Requires service_role or privileged SQL path.
SELECT *
FROM public.cron_job_run_details_health();

-- 2. One small prune batch. Recommended first production call:
--    keep_latest=20000, batch_size=5000, max_batches=5
SELECT *
FROM public.prune_cron_job_run_details(20000, 5000, 5);

-- 3. Repeat step 1 + 2 until deleted_count = 0 OR cron delivery recovers.
--    If each call is comfortably fast, max_batches may be increased to 10.

-- 4. Verify regnskap cron reader remains fast for admins.
--    Run through authenticated admin RPC path, not direct cron schema SELECT.
SELECT *
FROM public.list_regnskap_cron_runs(10);
