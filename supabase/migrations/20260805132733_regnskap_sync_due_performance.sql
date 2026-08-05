-- Regnskap-sync due candidate performance.
--
-- Keeps the cron contract unchanged while making the dominant mode='due'
-- catchup queue index-friendly. This migration intentionally creates only the
-- small required ready-queue expression index. Other optional status indexes
-- are deferred because the Lovable-managed Tiny target hit gateway timeouts
-- when several indexes were built in one migration.

CREATE INDEX IF NOT EXISTS idx_rss_ready_pending_retry_due
  ON reg.regnskap_sync_status (
    (COALESCE(next_attempt_at, '-infinity'::timestamptz)),
    last_checked_at,
    organisasjonsnummer
  )
  WHERE status IN ('pending', 'retry', 'due');

ANALYZE reg.regnskap_sync_status;
