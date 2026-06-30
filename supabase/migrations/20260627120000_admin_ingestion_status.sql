-- Admin ingestion overview for Brreg/Regnskap/NAV.
-- Read-only contract for Admin UI. No sync, cron, secret or lifecycle changes.

CREATE INDEX IF NOT EXISTS idx_source_postings_nav_created_at
  ON public.source_postings (created_at)
  WHERE source = 'nav';

CREATE INDEX IF NOT EXISTS idx_regnskap_hentet_tidspunkt
  ON reg.regnskap (hentet_tidspunkt DESC);

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

  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE NOT COALESCE(e.slettet, false))::bigint,
    count(*) FILTER (WHERE COALESCE(e.slettet, false))::bigint,
    max(e.hentet_tidspunkt),
    max(e.oppdatert_tidspunkt)
  INTO
    v_enheter_total,
    v_enheter_active,
    v_enheter_deleted,
    v_enheter_latest_fetched,
    v_enheter_latest_updated
  FROM reg.enheter e;

  WITH regnskap_orgs AS (
    SELECT
      r.organisasjonsnummer,
      count(*)::bigint AS row_count,
      max(r.regnskapsaar) AS latest_year,
      max(r.hentet_tidspunkt) AS latest_fetched_at
    FROM reg.regnskap r
    GROUP BY r.organisasjonsnummer
  )
  SELECT
    COALESCE(sum(ro.row_count), 0)::bigint,
    count(*)::bigint,
    count(*) FILTER (WHERE e.organisasjonsnummer IS NOT NULL)::bigint,
    max(ro.latest_year)::integer,
    max(ro.latest_fetched_at)
  INTO
    v_regnskap_rows,
    v_regnskap_orgs,
    v_regnskap_orgs_in_enheter,
    v_regnskap_latest_year,
    v_regnskap_latest_fetched
  FROM regnskap_orgs ro
  LEFT JOIN reg.enheter e
    ON e.organisasjonsnummer = ro.organisasjonsnummer;

  v_regnskap_remaining_local := GREATEST(v_enheter_active - v_regnskap_orgs_in_enheter, 0);

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
    count(*) FILTER (WHERE s.status = 'in_progress')::bigint,
    count(*) FILTER (
      WHERE s.status = 'in_progress'
        AND s.last_checked_at < now() - interval '10 minutes'
    )::bigint,
    count(*) FILTER (WHERE s.status IN ('no_regnskap', 'not_found'))::bigint,
    count(*) FILTER (WHERE s.status IN ('retry', 'forbidden', 'client_error'))::bigint,
    max(s.last_success_at),
    max(s.last_checked_at)
  INTO
    v_status_total,
    v_status_never_succeeded,
    v_status_in_progress,
    v_status_stuck,
    v_status_no_regnskap,
    v_status_failed_or_retry,
    v_status_latest_success,
    v_status_latest_checked
  FROM reg.regnskap_sync_status s;

  SELECT count(*)::bigint
  INTO v_status_missing
  FROM reg.enheter e
  LEFT JOIN reg.regnskap_sync_status s
    ON s.organisasjonsnummer = e.organisasjonsnummer
  WHERE NOT COALESCE(e.slettet, false)
    AND s.organisasjonsnummer IS NULL;

  SELECT count(*)::bigint
  INTO v_status_due
  FROM reg.enheter e
  LEFT JOIN reg.regnskap_sync_status s
    ON s.organisasjonsnummer = e.organisasjonsnummer
  WHERE NOT COALESCE(e.slettet, false)
    AND (
      s.organisasjonsnummer IS NULL
      OR (
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
      count(DISTINCT sp.source_external_id)::bigint AS new_unique_postings,
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

  SELECT
    count(*)::bigint,
    count(DISTINCT sp.source_external_id) FILTER (WHERE sp.posting_status = 'active')::bigint,
    count(*) FILTER (WHERE sp.posting_status IN ('expired', 'removed'))::bigint,
    max(sp.created_at),
    max(sp.last_seen_at)
  INTO
    v_nav_total,
    v_nav_active,
    v_nav_inactive,
    v_nav_latest_created,
    v_nav_latest_seen
  FROM public.source_postings sp
  WHERE sp.source = 'nav';

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
    'brreg', jsonb_build_object(
      'enhetsregisteret', jsonb_build_object(
        'downloaded_total', v_enheter_total,
        'downloaded_active', v_enheter_active,
        'downloaded_deleted', v_enheter_deleted,
        'latest_fetched_at', v_enheter_latest_fetched,
        'latest_updated_at', v_enheter_latest_updated,
        'upstream_total', NULL,
        'remaining_upstream', NULL,
        'remaining_reason', 'upstream total is not stored in the local mirror'
      ),
      'regnskapsregisteret', jsonb_build_object(
        'rows_total', v_regnskap_rows,
        'companies_with_min_1_year', v_regnskap_orgs,
        'companies_with_min_1_year_in_enhetsregisteret', v_regnskap_orgs_in_enheter,
        'latest_regnskapsaar', v_regnskap_latest_year,
        'latest_fetched_at', v_regnskap_latest_fetched,
        'remaining_against_local_enhetsregisteret', v_regnskap_remaining_local,
        'remaining_estimate_kind', 'local_enhetsregisteret_without_regnskap_row',
        'remaining_explanation', 'Counts mirrored, non-deleted enheter without any row in reg.regnskap. Some may legitimately have no public annual accounts.'
      ),
      'regnskap_sync', jsonb_build_object(
        'status_total', v_status_total,
        'missing_status_rows', v_status_missing,
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
      'active_unique_postings', COALESCE(v_nav_active, 0),
      'inactive_rows', v_nav_inactive,
      'new_unique_postings_window', v_nav_new_window,
      'daily_new_unique_postings', v_nav_daily,
      'latest_source_posting_created_at', v_nav_latest_created,
      'latest_source_posting_seen_at', v_nav_latest_seen,
      'latest_run', v_nav_latest_run,
      'daily_definition', 'Distinct NAV source_external_id first inserted into public.source_postings per local calendar date.'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_ingestion_status(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_ingestion_status(integer, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_admin_ingestion_status(integer, text) IS
  'Admin-only read model for Brreg/Regnskap/NAV ingestion counts. Returns JSONB; no mutations.';
