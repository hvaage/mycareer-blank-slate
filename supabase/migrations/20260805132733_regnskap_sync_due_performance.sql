-- Regnskap-sync due candidate performance.
--
-- Keeps the cron contract unchanged while making mode='due' index-friendly:
-- the Edge Function now reads due candidates from small status-specific
-- branches instead of one LEFT JOIN/global sort over reg.enheter. This
-- migration supplies the matching partial indexes and materializes currently
-- missing status rows once, so normal due-runs no longer need an anti-join.

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

WITH inserted AS (
  INSERT INTO reg.regnskap_sync_status (
    organisasjonsnummer,
    status,
    next_attempt_at,
    backoff_until
  )
  SELECT
    e.organisasjonsnummer,
    'pending',
    now(),
    NULL
  FROM reg.enheter e
  WHERE COALESCE(e.slettet, false) = false
    AND NOT EXISTS (
      SELECT 1
      FROM reg.regnskap_sync_status s
      WHERE s.organisasjonsnummer = e.organisasjonsnummer
    )
  ON CONFLICT (organisasjonsnummer) DO NOTHING
  RETURNING organisasjonsnummer
)
SELECT count(*) AS inserted_missing_regnskap_sync_status_rows
FROM inserted;

ANALYZE reg.regnskap_sync_status;
