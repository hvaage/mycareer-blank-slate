-- Regnskap-sync due safe rollout guard.
--
-- This migration makes the deployment safe whether
-- 20260805132733_regnskap_sync_due_performance committed before its client
-- timeout or rolled back. It only creates the missing expression index used by
-- the rewritten pending/retry/due branch. Planner statistics refresh is left
-- to ordinary database maintenance because the Lovable-managed target gateway
-- timed out while refreshing statistics through the migration API.

CREATE INDEX IF NOT EXISTS idx_rss_ready_pending_retry_due
  ON reg.regnskap_sync_status (
    (COALESCE(next_attempt_at, '-infinity'::timestamptz)),
    last_checked_at,
    organisasjonsnummer
  )
  WHERE status IN ('pending', 'retry', 'due');
