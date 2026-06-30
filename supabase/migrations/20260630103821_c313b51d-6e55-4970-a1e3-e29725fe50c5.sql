-- Fast path for Admin ingestion overview.
-- Keeps the existing JSON contract but avoids repeated full-table scans over
-- large mirror tables on every Admin page load.

CREATE INDEX IF NOT EXISTS idx_admin_enheter_active_orgnr
  ON reg.enheter (organisasjonsnummer)
  WHERE COALESCE(slettet, false) = false;

CREATE INDEX IF NOT EXISTS idx_admin_enheter_hentet_tidspunkt
  ON reg.enheter (hentet_tidspunkt DESC)
  WHERE hentet_tidspunkt IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_enheter_oppdatert_tidspunkt
  ON reg.enheter (oppdatert_tidspunkt DESC)
  WHERE oppdatert_tidspunkt IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_regnskap_regnskapsaar
  ON reg.regnskap (regnskapsaar DESC)
  WHERE regnskapsaar IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_regnskap_sync_with_rows
  ON reg.regnskap_sync_status (organisasjonsnummer)
  WHERE latest_regnskapsaar IS NOT NULL
     OR records_lagret > 0
     OR last_success_at IS NOT NULL
     OR status = 'ok';

CREATE INDEX IF NOT EXISTS idx_admin_regnskap_sync_runs_started
  ON reg.regnskap_sync_runs (started_at DESC NULLS LAST, id DESC);

CREATE INDEX IF NOT EXISTS idx_admin_source_postings_nav_external
  ON public.source_postings (source_external_id)
  WHERE source = 'nav';

CREATE INDEX IF NOT EXISTS idx_admin_source_postings_nav_active_external
  ON public.source_postings (source_external_id)
  WHERE source = 'nav' AND posting_status = 'active';

CREATE INDEX IF NOT EXISTS idx_admin_source_postings_nav_created_external
  ON public.source_postings (created_at, source_external_id)
  WHERE source = 'nav';

CREATE INDEX IF NOT EXISTS idx_admin_source_postings_nav_last_seen
  ON public.source_postings (last_seen_at DESC)
  WHERE source = 'nav' AND last_seen_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_nav_sync_runs_started
  ON public.nav_sync_runs (started_at DESC NULLS LAST);

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
  v_regnskap_latest_fetched timestamptz;
  v_regnskap_remaining_local bigint := 0;

  v_status_by_status jsonb := '{}'::jsonb;
  v_status_total bigint := 0;
  v_status_missing bigint := 0;
  v_status_never_succeeded bigint := 0;
  v_status_due bigint := 0;
  v_status_in_progress bigint := 0;
  v_status_stuck bigint := 0;
  v_status_no_regnskap bigint := 0;
  v_status_failed_or_retry bigint := 0;
  v_status_latest_success timestamptz;
  v_status_latest_checked timestamptz;

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

  SELECT COALESCE(GREATEST(c.reltuples::bigint, 0), 0)
  INTO v_enheter_total
  FROM pg_class c
  WHERE c.oid = 'reg.enheter'::regclass;

  SELECT COALESCE(GREATEST(c.reltuples::bigint, 0), 0)
  INTO v_enheter_active
  FROM pg_class c
  WHERE c.oid = to_regclass('reg.idx_admin_enheter_active_orgnr');

  v_enheter_total := COALESCE(v_enheter_total, 0);
  v_enheter_active := COALESCE(v_enheter_active, 0);
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

  SELECT COALESCE(GREATEST(c.reltuples::bigint, 0), 0)
  INTO v_regnskap_rows
  FROM pg_class c
  WHERE c.oid = 'reg.regnskap'::regclass;

  SELECT r.regnskapsaar
  INTO v_regnskap_latest_year
  FROM reg.regnskap r
  WHERE r.regnskapsaar IS NOT NULL
  ORDER BY r.regnskapsaar DESC
  LIMIT 1;

  SELECT r.hentet_tidspunkt
  INTO v_regnskap_latest_fetched
  FROM reg.regnskap r
  WHERE r.hentet_tidspunkt IS NOT NULL
  ORDER BY r.hentet_tidspunkt DESC
  LIMIT 1;

  SELECT COALESCE(jsonb_object_agg(status_key, n ORDER BY status_key), '{}'::jsonb)
  INTO v_status_by_status
  FROM (
    SELECT COALESCE(NULLIF(s.status, ''), 'unknown') AS status_key, count(*)::bigint AS n
    FROM reg.regnskap_sync_status s
    GROUP BY COALESCE(NULLIF(s.status, ''), 'unknown')
  ) by_status;

  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE s.last_success_at IS NULL)::bigint,
    count(*) FILTER (
      WHERE s.latest_regnskapsaar IS NOT NULL
         OR s.records_lagret > 0
         OR s.last_success_at IS NOT NULL
         OR s.status = 'ok'
    )::bigint,
    count(*) FILTER (
      WHERE s.latest_regnskapsaar IS NOT NULL
         OR s.records_lagret > 0
         OR s.last_success_at IS NOT NULL
         OR s.status = 'ok'
    )::bigint,
    COALESCE(max(s.latest_regnskapsaar)::integer, v_regnskap_latest_year),
    count(*) FILTER (WHERE s.status = 'in_progress')::bigint,
    count(*) FILTER (
      WHERE s.status = 'in_progress'
        AND s.last_checked_at < now() - interval '10 minutes'
    )::bigint,
    count(*) FILTER (WHERE s.status IN ('no_regnskap', 'not_found'))::bigint,
    count(*) FILTER (WHERE s.status IN ('retry', 'forbidden', 'client_error'))::bigint,
    count(*) FILTER (
      WHERE (
        s.status IN ('pending', 'retry', 'due')
        AND COALESCE(s.backoff_until, '-infinity'::timestamptz) <= now()
        AND COALESCE(s.next_attempt_at, '-infinity'::timestamptz) <= now()
      )
      OR (
        s.status = 'ok'
        AND (
          s.next_attempt_at <= now()
          OR s.last_success_at < now() - interval '180 days'
        )
      )
      OR (
        s.status = 'no_regnskap'
        AND s.last_checked_at < now() - interval '90 days'
      )
      OR (
        s.status = 'not_found'
        AND s.last_checked_at < now() - interval '180 days'
      )
      OR (
        s.status = 'in_progress'
        AND s.last_checked_at < now() - interval '10 minutes'
      )
    )::bigint,
    max(s.last_success_at),
    max(s.last_checked_at)
  INTO
    v_status_total,
    v_status_never_succeeded,
    v_regnskap_orgs,
    v_regnskap_orgs_in_enheter,
    v_regnskap_latest_year,
    v_status_in_progress,
    v_status_stuck,
    v_status_no_regnskap,
    v_status_failed_or_retry,
    v_status_due,
    v_status_latest_success,
    v_status_latest_checked
  FROM reg.regnskap_sync_status s;

  v_status_missing := GREATEST(v_enheter_active - v_status_total, 0);
  v_status_due := v_status_due + v_status_missing;
  v_regnskap_remaining_local := GREATEST(v_enheter_active - v_regnskap_orgs_in_enheter, 0);

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

  SELECT COALESCE(GREATEST(c.reltuples::bigint, 0), 0)
  INTO v_nav_total
  FROM pg_class c
  WHERE c.oid = to_regclass('public.idx_admin_source_postings_nav_external');

  SELECT COALESCE(GREATEST(c.reltuples::bigint, 0), 0)
  INTO v_nav_active
  FROM pg_class c
  WHERE c.oid = to_regclass('public.idx_admin_source_postings_nav_active_external');

  v_nav_total := COALESCE(v_nav_total, 0);
  v_nav_active := COALESCE(v_nav_active, 0);
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
      'regnskap_companies', 'regnskap_sync_status_success_rows',
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
        'companies_count_basis', 'regnskap_sync_status rows with latest_regnskapsaar, records_lagret, last_success_at or ok status',
        'latest_regnskapsaar', v_regnskap_latest_year,
        'latest_fetched_at', v_regnskap_latest_fetched,
        'remaining_against_local_enhetsregisteret', v_regnskap_remaining_local,
        'remaining_estimate_kind', 'local_enhetsregisteret_estimate_minus_regnskap_sync_success_rows',
        'remaining_explanation', 'Fast dashboard estimate: mirrored, non-deleted enheter estimate minus regnskap sync rows with at least one successful/account-bearing result. Some enheter may legitimately have no public annual accounts.'
      ),
      'regnskap_sync', jsonb_build_object(
        'status_total', v_status_total,
        'missing_status_rows', v_status_missing,
        'missing_status_rows_is_estimate', true,
        'never_succeeded', v_status_never_succeeded,
        'due_now_estimate', v_status_due,
        'in_progress', v_status_in_progress,
        'in_progress_stuck', v_status_stuck,
        'known_no_regnskap_or_not_found', v_status_no_regnskap,
        'failed_or_retry', v_status_failed_or_retry,
        'latest_success_at', v_status_latest_success,
        'latest_checked_at', v_status_latest_checked,
        'by_status', v_status_by_status,
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
  'Admin-only read model for Brreg/Regnskap/NAV ingestion counts. Fast dashboard path; no mutations.';