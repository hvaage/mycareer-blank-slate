-- Regnskap-sync due candidate performance.
--
-- Keeps the cron contract unchanged while making the dominant mode='due'
-- catchup queue index-friendly. This migration intentionally creates only the
-- small required ready-queue expression index. Planner statistics refresh is
-- intentionally left to ordinary database maintenance because the
-- Lovable-managed target gateway timed out while refreshing statistics through
-- the migration API.

CREATE INDEX IF NOT EXISTS idx_rss_ready_pending_retry_due
  ON reg.regnskap_sync_status (
    (COALESCE(next_attempt_at, '-infinity'::timestamptz)),
    last_checked_at,
    organisasjonsnummer
  )
  WHERE status IN ('pending', 'retry', 'due');