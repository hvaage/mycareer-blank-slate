
-- NAV target reconciliation foundation (Lovable target side).
-- Non-destructive: ADD COLUMN ... NULL (no backfill), new state tables, new admin RPCs.

-- 1) source_postings: add upstream-derived metadata. Nullable; populated only on real merges.
ALTER TABLE public.source_postings
  ADD COLUMN IF NOT EXISTS source_event_version timestamptz,
  ADD COLUMN IF NOT EXISTS source_payload_hash  text,
  ADD COLUMN IF NOT EXISTS source_event_id      text;

COMMENT ON COLUMN public.source_postings.source_event_version IS 'Upstream-derived event version (NAV nav_event_modified_at / date_modified / sistEndret / nav_detail.*updated). Never mirror/import time.';
COMMENT ON COLUMN public.source_postings.source_payload_hash  IS 'Deterministic hash of the persisted scalars + canonical merged raw_payload. Identical (version, hash) is a no-op.';
COMMENT ON COLUMN public.source_postings.source_event_id      IS 'Upstream event correlation id, when provided.';

-- Partial index for sweeping NAV rows that still need their first conditional merge.
CREATE INDEX IF NOT EXISTS idx_source_postings_nav_repair_pending
  ON public.source_postings (source_external_id)
  WHERE source = 'nav' AND source_event_version IS NULL;

-- Partial index to look up event version for conditional-merge predicates.
CREATE INDEX IF NOT EXISTS idx_source_postings_nav_version
  ON public.source_postings (source_external_id, source_event_version)
  WHERE source = 'nav';

-- 2) nav_repair_runs: resumable by-ID repair state.
CREATE TABLE IF NOT EXISTS public.nav_repair_runs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at                timestamptz NOT NULL DEFAULT now(),
  finished_at               timestamptz,
  status                    text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','failed','cancelled')),
  cursor_after_external_id  text NOT NULL DEFAULT '',
  total_target_rows         integer,
  batches_processed         integer NOT NULL DEFAULT 0,
  ids_requested             integer NOT NULL DEFAULT 0,
  ids_found                 integer NOT NULL DEFAULT 0,
  ids_missing               integer NOT NULL DEFAULT 0,
  rows_merged               integer NOT NULL DEFAULT 0,
  rows_noop                 integer NOT NULL DEFAULT 0,
  rows_stale_ignored        integer NOT NULL DEFAULT 0,
  rows_failed               integer NOT NULL DEFAULT 0,
  last_error                text,
  meta                      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.nav_repair_runs TO authenticated;
GRANT ALL ON public.nav_repair_runs TO service_role;

ALTER TABLE public.nav_repair_runs ENABLE ROW LEVEL SECURITY;

-- Admin-only read; mutations stay on service_role only (RLS denies authenticated writes by absence of policy).
CREATE POLICY "nav_repair_runs admin select"
  ON public.nav_repair_runs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX IF NOT EXISTS idx_nav_repair_runs_started_at ON public.nav_repair_runs (started_at DESC);

DROP TRIGGER IF EXISTS trg_nav_repair_runs_set_updated_at ON public.nav_repair_runs;
CREATE TRIGGER trg_nav_repair_runs_set_updated_at
  BEFORE UPDATE ON public.nav_repair_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) Admin RPCs for the read-only /admin/sync dashboard.
CREATE OR REPLACE FUNCTION public.nav_sync_target_inventory()
RETURNS TABLE (
  total bigint,
  active bigint,
  inactive bigint,
  active_with_detail bigint,
  active_missing_detail bigint,
  active_with_extent bigint,
  active_with_engagement bigint,
  active_with_event_version bigint,
  rows_with_event_version bigint,
  duplicate_external_ids bigint,
  max_last_seen_at timestamptz,
  max_source_event_version timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH nav AS (
    SELECT * FROM public.source_postings WHERE source = 'nav'
  ),
  dup AS (
    SELECT count(*)::bigint AS n FROM (
      SELECT source_external_id FROM nav
      WHERE source_external_id IS NOT NULL
      GROUP BY source_external_id HAVING count(*) > 1
    ) d
  )
  SELECT
    (SELECT count(*) FROM nav)::bigint,
    (SELECT count(*) FROM nav WHERE posting_status = 'active')::bigint,
    (SELECT count(*) FROM nav WHERE posting_status IN ('expired','removed'))::bigint,
    (SELECT count(*) FROM nav WHERE posting_status = 'active' AND (raw_payload->'nav_detail') IS NOT NULL)::bigint,
    (SELECT count(*) FROM nav WHERE posting_status = 'active' AND (raw_payload->'nav_detail') IS NULL)::bigint,
    (SELECT count(*) FROM nav WHERE posting_status = 'active' AND work_extent IS NOT NULL)::bigint,
    (SELECT count(*) FROM nav WHERE posting_status = 'active' AND engagement_type IS NOT NULL)::bigint,
    (SELECT count(*) FROM nav WHERE posting_status = 'active' AND source_event_version IS NOT NULL)::bigint,
    (SELECT count(*) FROM nav WHERE source_event_version IS NOT NULL)::bigint,
    (SELECT n FROM dup),
    (SELECT max(last_seen_at) FROM nav),
    (SELECT max(source_event_version) FROM nav);
END;
$$;

REVOKE ALL ON FUNCTION public.nav_sync_target_inventory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nav_sync_target_inventory() TO authenticated, service_role;
COMMENT ON FUNCTION public.nav_sync_target_inventory() IS 'Admin-only target NAV inventory counts for /admin/sync.';

CREATE OR REPLACE FUNCTION public.nav_sync_target_cursor()
RETURNS TABLE (
  latest_cursor_changed_at timestamptz,
  latest_cursor_external_id text,
  last_successful_run_id uuid,
  last_successful_finished_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_finished timestamptz;
  v_meta jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;
  SELECT id, finished_at, meta
    INTO v_id, v_finished, v_meta
  FROM public.nav_sync_runs
  WHERE finished_at IS NOT NULL AND error_summary IS NULL
    AND COALESCE((meta->>'mode'), 'cursor') = 'cursor'
  ORDER BY finished_at DESC NULLS LAST
  LIMIT 1;
  RETURN QUERY SELECT
    NULLIF(v_meta->>'cursor_changed_at', '')::timestamptz,
    NULLIF(v_meta->>'cursor_external_id', ''),
    v_id,
    v_finished;
END;
$$;

REVOKE ALL ON FUNCTION public.nav_sync_target_cursor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nav_sync_target_cursor() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.nav_sync_repair_progress()
RETURNS TABLE (
  active_run_id uuid,
  active_run_started_at timestamptz,
  active_run_status text,
  active_run_cursor_after text,
  active_run_batches integer,
  active_run_ids_requested integer,
  active_run_ids_found integer,
  active_run_ids_missing integer,
  active_run_rows_merged integer,
  active_run_rows_noop integer,
  active_run_rows_stale integer,
  active_run_rows_failed integer,
  last_completed_id uuid,
  last_completed_finished_at timestamptz,
  last_completed_status text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_a record;
  v_c record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_a FROM public.nav_repair_runs
   WHERE status = 'running' ORDER BY started_at DESC LIMIT 1;
  SELECT id, finished_at, status INTO v_c FROM public.nav_repair_runs
   WHERE status IN ('completed','failed','cancelled') ORDER BY finished_at DESC NULLS LAST LIMIT 1;
  RETURN QUERY SELECT
    v_a.id, v_a.started_at, v_a.status, v_a.cursor_after_external_id,
    v_a.batches_processed, v_a.ids_requested, v_a.ids_found, v_a.ids_missing,
    v_a.rows_merged, v_a.rows_noop, v_a.rows_stale_ignored, v_a.rows_failed,
    v_c.id, v_c.finished_at, v_c.status;
END;
$$;

REVOKE ALL ON FUNCTION public.nav_sync_repair_progress() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nav_sync_repair_progress() TO authenticated, service_role;
