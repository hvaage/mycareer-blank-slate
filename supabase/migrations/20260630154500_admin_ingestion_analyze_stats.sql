-- Refresh planner statistics for Admin ingestion status.
--
-- The latest timestamp indexes from 20260630152000 are valid, but production
-- still picked a parallel seq scan for reg.enheter. Refreshing table stats lets
-- the planner see the cheap DESC NULLS LAST index path for dashboard LIMIT 1
-- lookups. This migration does not change data, cron, secrets, RLS, or sync
-- behavior.

ANALYZE reg.enheter;
ANALYZE reg.regnskap;
ANALYZE reg.regnskap_sync_status;
ANALYZE public.source_postings;
