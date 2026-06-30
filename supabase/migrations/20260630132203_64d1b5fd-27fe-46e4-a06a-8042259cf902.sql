-- Ultrafast path for Admin ingestion overview.
--
-- The previous fast path removed the largest Brreg/source_postings scans, but
-- still aggregated all of reg.regnskap_sync_status on every admin page load.
-- During catchup this table is hot and growing. This migration switches those
-- dashboard counters to planner/index estimates and keeps exact reads limited
-- to indexed ORDER BY ... LIMIT 1 lookups and latest-run rows.

CREATE INDEX IF NOT EXISTS idx_admin_regnskap_sync_status_ok
  ON reg.regnskap_sync_status (organisasjonsnummer)
  WHERE status = 'ok';

CREATE INDEX IF NOT EXISTS idx_admin_regnskap_sync_with_rows
  ON reg.regnskap_sync_status (organisasjonsnummer)
  WHERE latest_regnskapsaar IS NOT NULL
     OR records_lagret > 0
     OR last_success_at IS NOT NULL
     OR status = 'ok';

CREATE INDEX IF NOT EXISTS idx_admin_regnskap_sync_status_no_regnskap
  ON reg.regnskap_sync_status (organisasjonsnummer)
  WHERE status = 'no_regnskap';

CREATE INDEX IF NOT EXISTS idx_admin_regnskap_sync_status_not_found
  ON reg.regnskap_sync_status (organisasjonsnummer)
  WHERE status = 'not_found';

CREATE INDEX IF NOT EXISTS idx_admin_regnskap_sync_status_pending
  ON reg.regnskap_sync_status (organisasjonsnummer)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_admin_regnskap_sync_status_due
  ON reg.regnskap_sync_status (organisasjonsnummer)
  WHERE status = 'due';

CREATE INDEX IF NOT EXISTS idx_admin_regnskap_sync_status_retry
  ON reg.regnskap_sync_status (organisasjonsnummer)
  WHERE status = 'retry';

CREATE INDEX IF NOT EXISTS idx_admin_regnskap_sync_status_forbidden
  ON reg.regnskap_sync_status (organisasjonsnummer)
  WHERE status = 'forbidden';

CREATE INDEX IF NOT EXISTS idx_admin_regnskap_sync_status_client_error
  ON reg.regnskap_sync_status (organisasjonsnummer)
  WHERE status = 'client_error';

CREATE INDEX IF NOT EXISTS idx_admin_regnskap_sync_status_in_progress
  ON reg.regnskap_sync_status (last_checked_at)
  WHERE status = 'in_progress';

CREATE INDEX IF NOT EXISTS idx_admin_regnskap_sync_last_success_at
  ON reg.regnskap_sync_status (last_success_at DESC)
  WHERE last_success_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_regnskap_sync_last_checked_at
  ON reg.regnskap_sync_status (last_checked_at DESC)
  WHERE last_checked_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_regnskap_sync_latest_regnskapsaar
  ON reg.regnskap_sync_status (latest_regnskapsaar DESC)
  WHERE latest_regnskapsaar IS NOT NULL;

CREATE OR REPLACE FUNCTION public._admin_estimated_rows(p_relation_name text)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((
    SELECT GREATEST(c.reltuples::bigint, 0)
    FROM pg_class c
    WHERE c.oid = to_regclass(p_relation_name)
  ), 0)::bigint;
$$;

REVOKE ALL ON FUNCTION public._admin_estimated_rows(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_ingestion_status(
  p_days integer DEFAULT 14,
  p_timezone text DEFAULT 'Europe/Oslo'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, reg, pg_temp
AS $$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 14), 1), 90);
  v_timezone text := COALESCE(NULLIF(btrim(p_timezone), ''), 'Europe/Oslo');
  v_now timestamptz := now();
  v_today date;
  v_from_date date;
  v_window_start timestamptz;
  v_window_end timestamptz;

  v_enheter_total bigint := 0;
  v_enheter_active bigint := 0;
  v_enheter_deleted bigint := 0;
  v_enheter_latest_fetched timestamptz;
  v_enheter_latest_updated timestamptz;

  v_regnskap_rows bigint := 0;
  v_regnskap_orgs bigint := 0;
  v_regnskap_orgs_in_enheter bigint := 0;
  v_regnskap_latest_year integer;
  v_regnskap_status_latest_year integer;
  v_regnskap_latest_fetched timestamptz;
  v_regnskap_remaining_local bigint := 0;

  v_status_by_status jsonb := '{}'::jsonb;
  v_status_total bigint := 0;
  v_status_missing bigint := 0;
  v_status_never_succeeded bigint := 0;
  v_status_due bigint := 0;
  v_status_due_status bigint := 0;
  v_status_in_progress bigint := 0;
  v_status_stuck bigint := 0;
  v_status_no_regnskap bigint := 0;
  v_status_not_found bigint := 0;
  v_status_pending bigint := 0;
  v_status_retry bigint := 0;
  v_status_forbidden bigint := 0;
  v_status_client_error bigint := 0;
  v_status_ok bigint := 0;
  v_status_unknown bigint := 0;
  v_status_failed_or_retry bigint := 0;
  v_status_latest_success timestamptz;
  v_status_latest_checked timestamptz;
  v_status_with_success bigint := 0;

  v_regnskap_latest_run jsonb := NULL;
  v_nav_daily jsonb := '[]'::jsonb;
  v_nav_total bigint := 0;
  v_nav_active bigint := 0;
  v_nav_inactive bigint := 0;
  v_nav_new_window bigint := 0;
  v_nav_latest_created timestamptz;
  v_nav_latest_seen timestamptz;
  v_nav_latest_run jsonb := NULL;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
      RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
    END IF;
  END IF;

  BEGIN
    v_today := (v_now AT TIME ZONE v_timezone)::date;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_timezone := 'Europe/Oslo';
    v_today := (v_now AT TIME ZONE v_timezone)::date;
  END;

  v_from_date := v_today - (v_days - 1);
  v_window_start := v_from_date::timestamp AT TIME ZONE v_timezone;
  v_window_end := (v_today + 1)::timestamp AT TIME ZONE v_timezone;

  v_enheter_total := public._admin_estimated_rows('reg.enheter');
  v_enheter_active := public._admin_estimated_rows('reg.idx_admin_enheter_active_orgnr');
  v_enheter_deleted := GREATEST(v_enheter_total - v_enheter_active, 0);

  SELECT e.hentet_tidspunkt
  INTO v_enheter_latest_fetched
  FROM reg.enheter e
  WHERE e.hentet_tidspunkt IS NOT NULL
  ORDER BY e.hentet_tidspunkt DESC
  LIMIT 1;

  SELECT e.oppdatert_tidspunkt
  INTO v_enheter_latest_updated
  FROM reg.enheter e
  WHERE e.oppdatert_tidspunkt IS NOT NULL
  ORDER BY e.oppdatert_tidspunkt DESC
  LIMIT 1;

  v_regnskap_rows := public._admin_estimated_rows('reg.regnskap');

  SELECT r.regnskapsaar
  INTO v_regnskap_latest_year
  FROM reg.regnskap r
  WHERE r.regnskapsaar IS NOT NULL
  ORDER BY r.regnskapsaar DESC
  LIMIT 1;

  SELECT s.latest_regnskapsaar
  INTO v_regnskap_status_latest_year
  FROM reg.regnskap_sync_status s
  WHERE s.latest_regnskapsaar IS NOT NULL
  ORDER BY s.latest_regnskapsaar DESC
  LIMIT 1;
  v_regnskap_latest_year := COALESCE(v_regnskap_status_latest_year, v_regnskap_latest_year);

  SELECT r.hentet_tidspunkt
  INTO v_regnskap_latest_fetched
  FROM reg.regnskap r
  WHERE r.hentet_tidspunkt IS NOT NULL
  ORDER BY r.hentet_tidspunkt DESC
  LIMIT 1;

  v_status_total := public._admin_estimated_rows('reg.regnskap_sync_status');
  v_status_ok := public._admin_estimated_rows('reg.idx_admin_regnskap_sync_status_ok');
  v_status_no_regnskap := public._admin_estimated_rows('reg.idx_admin_regnskap_sync_status_no_regnskap');
  v_status_not_found := public._admin_estimated_rows('reg.idx_admin_regnskap_sync_status_not_found');
  v_status_pending := public._admin_estimated_rows('reg.idx_admin_regnskap_sync_status_pending');
  v_status_due_status := public._admin_estimated_rows('reg.idx_admin_regnskap_sync_status_due');
  v_status_retry := public._admin_estimated_rows('reg.idx_admin_regnskap_sync_status_retry');
  v_status_forbidden := public._admin_estimated_rows('reg.idx_admin_regnskap_sync_status_forbidden');
  v_status_client_error := public._admin_estimated_rows('reg.idx_admin_regnskap_sync_status_client_error');
  v_status_in_progress := public._admin_estimated_rows('reg.idx_admin_regnskap_sync_status_in_progress');
  v_status_with_success := public._admin_estimated_rows('reg.idx_admin_regnskap_sync_last_success_at');
  v_regnskap_orgs := public._admin_estimated_rows('reg.idx_admin_regnskap_sync_with_rows');
  v_regnskap_orgs_in_enheter := v_regnskap_orgs;

  SELECT count(*)::bigint
  INTO v_status_stuck
  FROM reg.regnskap_sync_status s
  WHERE s.status = 'in_progress'
    AND s.last_checked_at < now() - interval '10 minutes';

  SELECT s.last_success_at
  INTO v_status_latest_success
  FROM reg.regnskap_sync_status s
  WHERE s.last_success_at IS NOT NULL
  ORDER BY s.last_success_at DESC
  LIMIT 1;

  SELECT s.last_checked_at
  INTO v_status_latest_checked
  FROM reg.regnskap_sync_status s
  WHERE s.last_checked_at IS NOT NULL
  ORDER BY s.last_checked_at DESC
  LIMIT 1;

  v_status_missing := GREATEST(v_enheter_active - v_status_total, 0);
  v_status_never_succeeded := GREATEST(v_status_total - v_status_with_success, 0);
  v_status_failed_or_retry := v_status_retry + v_status_forbidden + v_status_client_error;
  v_status_due := v_status_missing + v_status_pending + v_status_due_status + v_status_retry + v_status_stuck;
  v_status_unknown := GREATEST(
    v_status_total
      - v_status_ok
      - v_status_no_regnskap
      - v_status_not_found
      - v_status_pending
      - v_status_due_status
      - v_status_retry
      - v_status_forbidden
      - v_status_client_error
      - v_status_in_progress,
    0
  );
  v_regnskap_remaining_local := GREATEST(v_enheter_active - v_regnskap_orgs_in_enheter, 0);

  v_status_by_status := jsonb_build_object(
    'ok', v_status_ok,
    'no_regnskap', v_status_no_regnskap,
    'not_found', v_status_not_found,
    'pending', v_status_pending,
    'due', v_status_due_status,
    'retry', v_status_retry,
    'forbidden', v_status_forbidden,
    'client_error', v_status_client_error,
    'in_progress', v_status_in_progress,
    'unknown', v_status_unknown
  );

  SELECT jsonb_build_object(
    'id', rr.id,
    'started_at', rr.started_at,
    'finished_at', rr.finished_at,
    'status', rr.status,
    'mode', rr.mode,
    'selected_count', rr.selected_count,
    'checked_count', rr.checked_count,
    'with_regnskap_count', rr.with_regnskap_count,
    'no_regnskap_count', rr.no_regnskap_count,
    'failed_count', rr.failed_count,
    'skipped_count', rr.skipped_count,
    'records_lagret', rr.records_lagret,
    'duration_ms', rr.duration_ms,
    'last_error', rr.last_error
  )
  INTO v_regnskap_latest_run
  FROM reg.regnskap_sync_runs rr
  ORDER BY rr.started_at DESC NULLS LAST, rr.id DESC
  LIMIT 1;

  WITH days AS (
    SELECT generate_series(v_from_date, v_today, interval '1 day')::date AS local_date
  ),
  nav_created AS (
    SELECT
      (sp.created_at AT TIME ZONE v_timezone)::date AS local_date,
      count(*)::bigint AS new_unique_postings,
      count(*)::bigint AS inserted_rows
    FROM public.source_postings sp
    WHERE sp.source = 'nav'
      AND sp.created_at >= v_window_start
      AND sp.created_at < v_window_end
    GROUP BY 1
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'date', d.local_date,
          'new_unique_postings', COALESCE(nc.new_unique_postings, 0),
          'inserted_rows', COALESCE(nc.inserted_rows, 0)
        )
        ORDER BY d.local_date DESC
      ),
      '[]'::jsonb
    ),
    COALESCE(sum(COALESCE(nc.new_unique_postings, 0)), 0)::bigint
  INTO v_nav_daily, v_nav_new_window
  FROM days d
  LEFT JOIN nav_created nc
    ON nc.local_date = d.local_date;

  v_nav_total := public._admin_estimated_rows('public.idx_admin_source_postings_nav_external');
  v_nav_active := public._admin_estimated_rows('public.idx_admin_source_postings_nav_active_external');
  v_nav_inactive := GREATEST(v_nav_total - v_nav_active, 0);

  SELECT sp.created_at
  INTO v_nav_latest_created
  FROM public.source_postings sp
  WHERE sp.source = 'nav'
  ORDER BY sp.created_at DESC
  LIMIT 1;

  SELECT sp.last_seen_at
  INTO v_nav_latest_seen
  FROM public.source_postings sp
  WHERE sp.source = 'nav'
    AND sp.last_seen_at IS NOT NULL
  ORDER BY sp.last_seen_at DESC
  LIMIT 1;

  SELECT jsonb_build_object(
    'id', nsr.id,
    'started_at', nsr.started_at,
    'finished_at', nsr.finished_at,
    'mode', COALESCE(nsr.meta->>'mode', 'cursor'),
    'fetched', nsr.fetched,
    'upserted', nsr.upserted,
    'expired', nsr.expired,
    'reactivated', nsr.reactivated,
    'matched_user_opps', nsr.matched_user_opps,
    'scored', nsr.scored,
    'noop', CASE WHEN (nsr.meta->>'noop') ~ '^-?[0-9]+$' THEN (nsr.meta->>'noop')::integer ELSE NULL END,
    'stale', CASE WHEN (nsr.meta->>'stale') ~ '^-?[0-9]+$' THEN (nsr.meta->>'stale')::integer ELSE NULL END,
    'error_summary', nsr.error_summary
  )
  INTO v_nav_latest_run
  FROM public.nav_sync_runs nsr
  ORDER BY nsr.started_at DESC NULLS LAST
  LIMIT 1;

  RETURN jsonb_build_object(
    'generated_at', v_now,
    'timezone', v_timezone,
    'window', jsonb_build_object(
      'days', v_days,
      'from_date', v_from_date,
      'to_date', v_today,
      'start_at', v_window_start,
      'end_at', v_window_end
    ),
    'count_strategy', jsonb_build_object(
      'large_mirror_counts', 'planner_estimate',
      'regnskap_companies', 'regnskap_sync_status_partial_index_estimate',
      'regnskap_sync_status_counts', 'partial_index_estimate',
      'regnskap_due_now', 'missing_plus_pending_due_retry_stuck_estimate',
      'nav_daily_window', 'exact_source_postings_created_at_window',
      'latest_timestamps', 'indexed_order_by_limit'
    ),
    'brreg', jsonb_build_object(
      'enhetsregisteret', jsonb_build_object(
        'downloaded_total', v_enheter_total,
        'downloaded_active', v_enheter_active,
        'downloaded_deleted', v_enheter_deleted,
        'downloaded_counts_are_estimates', true,
        'latest_fetched_at', v_enheter_latest_fetched,
        'latest_updated_at', v_enheter_latest_updated,
        'upstream_total', NULL,
        'remaining_upstream', NULL,
        'remaining_reason', 'upstream total is not stored in the local mirror'
      ),
      'regnskapsregisteret', jsonb_build_object(
        'rows_total', v_regnskap_rows,
        'rows_total_is_estimate', true,
        'companies_with_min_1_year', v_regnskap_orgs,
        'companies_with_min_1_year_in_enhetsregisteret', v_regnskap_orgs_in_enheter,
        'companies_count_basis', 'estimated regnskap_sync_status partial index rows with latest_regnskapsaar, records_lagret, last_success_at or ok status',
        'latest_regnskapsaar', v_regnskap_latest_year,
        'latest_fetched_at', v_regnskap_latest_fetched,
        'remaining_against_local_enhetsregisteret', v_regnskap_remaining_local,
        'remaining_estimate_kind', 'local_enhetsregisteret_estimate_minus_regnskap_sync_success_rows',
        'remaining_explanation', 'Fast dashboard estimate: mirrored, non-deleted enheter estimate minus regnskap sync rows with at least one successful/account-bearing result. Some enheter may legitimately have no public annual accounts.'
      ),
      'regnskap_sync', jsonb_build_object(
        'status_total', v_status_total,
        'status_total_is_estimate', true,
        'missing_status_rows', v_status_missing,
        'missing_status_rows_is_estimate', true,
        'never_succeeded', v_status_never_succeeded,
        'never_succeeded_is_estimate', true,
        'due_now_estimate', v_status_due,
        'due_now_estimate_kind', 'missing_plus_pending_due_retry_stuck_estimate',
        'in_progress', v_status_in_progress,
        'in_progress_is_estimate', true,
        'in_progress_stuck', v_status_stuck,
        'known_no_regnskap_or_not_found', v_status_no_regnskap + v_status_not_found,
        'known_no_regnskap_or_not_found_is_estimate', true,
        'failed_or_retry', v_status_failed_or_retry,
        'failed_or_retry_is_estimate', true,
        'latest_success_at', v_status_latest_success,
        'latest_checked_at', v_status_latest_checked,
        'by_status', v_status_by_status,
        'by_status_is_estimate', true,
        'latest_run', v_regnskap_latest_run
      )
    ),
    'nav', jsonb_build_object(
      'source_postings_total', v_nav_total,
      'source_postings_total_is_estimate', true,
      'active_unique_postings', COALESCE(v_nav_active, 0),
      'active_unique_postings_is_estimate', true,
      'inactive_rows', v_nav_inactive,
      'inactive_rows_is_estimate', true,
      'new_unique_postings_window', v_nav_new_window,
      'daily_new_unique_postings', v_nav_daily,
      'latest_source_posting_created_at', v_nav_latest_created,
      'latest_source_posting_seen_at', v_nav_latest_seen,
      'latest_run', v_nav_latest_run,
      'daily_definition', 'Exact count of NAV source_postings first inserted per local calendar date in the selected window. source_external_id is unique per source, so inserted rows and new unique postings should match.'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_ingestion_status(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_ingestion_status(integer, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_admin_ingestion_status(integer, text) IS
  'Admin-only read model for Brreg/Regnskap/NAV ingestion counts. Ultrafast dashboard path; broad sync-status counts use estimates; no mutations.';