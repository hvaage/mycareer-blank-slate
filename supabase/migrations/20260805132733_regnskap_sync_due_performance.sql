-- Regnskap-sync due candidate performance.
--
-- Keeps the cron contract unchanged while making mode='due' index-friendly:
-- the Edge Function now reads due candidates from small status-specific
-- branches instead of one LEFT JOIN/global sort over reg.enheter. This
-- migration supplies the matching partial indexes only. It intentionally does
-- not backfill missing status rows, because the ordinary due path no longer
-- needs that anti-join and the target project is too small for large blocking
-- mixed DDL/DML migrations under cron load.

CREATE INDEX IF NOT EXISTS idx_rss_ready_pending_retry_due
  ON reg.regnskap_sync_status (
    (COALESCE(next_attempt_at, '-infinity'::timestamptz)),
    last_checked_at,
    organisasjonsnummer
  )
  WHERE status IN ('pending', 'retry', 'due');

CREATE INDEX IF NOT EXISTS idx_rss_ok_next_attempt
  ON reg.regnskap_sync_status (next_attempt_at, last_checked_at, organisasjonsnummer)
  WHERE status = 'ok' AND next_attempt_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rss_ok_last_success
  ON reg.regnskap_sync_status (last_success_at, organisasjonsnummer)
  WHERE status = 'ok' AND last_success_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rss_no_regnskap_checked
  ON reg.regnskap_sync_status (last_checked_at, organisasjonsnummer)
  WHERE status = 'no_regnskap' AND last_checked_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rss_not_found_checked
  ON reg.regnskap_sync_status (last_checked_at, organisasjonsnummer)
  WHERE status = 'not_found' AND last_checked_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rss_in_progress_checked
  ON reg.regnskap_sync_status (last_checked_at, organisasjonsnummer)
  WHERE status = 'in_progress' AND last_checked_at IS NOT NULL;

ANALYZE reg.regnskap_sync_status;
