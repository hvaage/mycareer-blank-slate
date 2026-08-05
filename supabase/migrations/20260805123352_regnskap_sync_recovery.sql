-- Regnskap-sync operational recovery.
--
-- Fixes two production-control issues without touching reg.enheter or
-- reg.regnskap payload/history:
-- 1. The admin UI RPC is admin-gated internally, so authenticated users need
--    EXECUTE in order for admins to see pg_cron delivery status.
-- 2. Stale regnskap-sync leases older than 10 minutes are safe to recover to
--    retry. Active in-progress rows are left untouched.

DO $$
BEGIN
  IF to_regprocedure('public.list_regnskap_cron_runs(integer)') IS NULL THEN
    RAISE EXCEPTION 'public.list_regnskap_cron_runs(integer) is missing';
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.list_regnskap_cron_runs(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_regnskap_cron_runs(integer) TO authenticated, service_role;

WITH recovered AS (
  UPDATE reg.regnskap_sync_status
  SET
    status = 'retry',
    backoff_until = now(),
    next_attempt_at = now(),
    last_error = COALESCE(last_error, 'recovered stale in_progress by 20260805123352_regnskap_sync_recovery'),
    updated_at = now()
  WHERE status = 'in_progress'
    AND COALESCE(last_checked_at, '-infinity'::timestamptz) < now() - interval '10 minutes'
  RETURNING organisasjonsnummer
)
SELECT count(*) AS recovered_stale_in_progress
FROM recovered;
