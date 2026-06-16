-- 1) reg.regnskap_sync_status: backoff + planlegging
ALTER TABLE reg.regnskap_sync_status
  ADD COLUMN IF NOT EXISTS next_attempt_at      timestamptz,
  ADD COLUMN IF NOT EXISTS backoff_until        timestamptz,
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_regnskap_sync_status_next_attempt
  ON reg.regnskap_sync_status (next_attempt_at)
  WHERE status IN ('pending','retry','due');

-- 2) reg.regnskap_sync_runs: mode + retry/budsjett/varighet
ALTER TABLE reg.regnskap_sync_runs
  ADD COLUMN IF NOT EXISTS mode             text,
  ADD COLUMN IF NOT EXISTS http_429_count   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS http_503_count   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_count      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duration_ms      integer,
  ADD COLUMN IF NOT EXISTS time_budget_ms   integer,
  ADD COLUMN IF NOT EXISTS rps_setting      numeric,
  ADD COLUMN IF NOT EXISTS meta             jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 3) reg.regnskap_sync_run_items: per-orgnr feil/sample (RLS on, ingen policies, ingen GRANT)
CREATE TABLE IF NOT EXISTS reg.regnskap_sync_run_items (
  id                  bigserial PRIMARY KEY,
  run_id              bigint NOT NULL REFERENCES reg.regnskap_sync_runs(id) ON DELETE CASCADE,
  organisasjonsnummer text   NOT NULL,
  status              text   NOT NULL,
  http_status         integer,
  attempts            integer NOT NULL DEFAULT 1,
  latency_ms          integer,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reg.regnskap_sync_run_items ENABLE ROW LEVEL SECURITY;
-- Bevisst: ingen policies, ingen GRANT til anon/authenticated.
-- reg-schema er ikke eksponert i Data API. Service role (BYPASSRLS) håndterer all I/O.

CREATE INDEX IF NOT EXISTS idx_run_items_run    ON reg.regnskap_sync_run_items(run_id);
CREATE INDEX IF NOT EXISTS idx_run_items_orgnr  ON reg.regnskap_sync_run_items(organisasjonsnummer);
CREATE INDEX IF NOT EXISTS idx_run_items_status ON reg.regnskap_sync_run_items(status)
  WHERE status <> 'ok';