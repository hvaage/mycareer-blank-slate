-- Remove large-table latest timestamp scans from Admin ingestion status.
--
-- Even with matching indexes and fresh ANALYZE, production kept planning
-- parallel seq scans for reg.enheter latest timestamp LIMIT 1 lookups. For the
-- dashboard, approximate "latest" values from pg_stats are preferable to
-- timing out. Counts were already estimate-based; this applies the same
-- principle to latest timestamps on large mirror tables.

CREATE OR REPLACE FUNCTION public._admin_pg_stats_upper_text(
  p_schemaname text,
  p_tablename text,
  p_attname text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_bounds text;
  v_last text;
BEGIN
  SELECT s.histogram_bounds::text
  INTO v_bounds
  FROM pg_stats s
  WHERE s.schemaname = p_schemaname
    AND s.tablename = p_tablename
    AND s.attname = p_attname;

  IF v_bounds IS NULL OR v_bounds IN ('{}', '') THEN
    RETURN NULL;
  END IF;

  v_last := substring(v_bounds from '"([^"]+)"\}$');
  IF v_last IS NULL THEN
    v_last := regexp_replace(v_bounds, '^.*[,{]([^,{}]+)\}$', '\1');
  END IF;

  v_last := NULLIF(btrim(v_last, '"'), '');
  RETURN v_last;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._admin_pg_stats_upper_timestamptz(
  p_schemaname text,
  p_tablename text,
  p_attname text
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_value text;
BEGIN
  v_value := public._admin_pg_stats_upper_text(p_schemaname, p_tablename, p_attname);
  IF v_value IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_value::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._admin_pg_stats_upper_integer(
  p_schemaname text,
  p_tablename text,
  p_attname text
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_value text;
BEGIN
  v_value := public._admin_pg_stats_upper_text(p_schemaname, p_tablename, p_attname);
  IF v_value IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_value::integer;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._admin_pg_stats_upper_text(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._admin_pg_stats_upper_timestamptz(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._admin_pg_stats_upper_integer(text, text, text) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_sql text;
BEGIN
  SELECT pg_get_functiondef('public.get_admin_ingestion_status(integer,text)'::regprocedure)
  INTO v_sql;

  IF v_sql IS NULL THEN
    RAISE EXCEPTION 'public.get_admin_ingestion_status(integer,text) not found';
  END IF;

  v_sql := regexp_replace(
    v_sql,
    'SELECT e\.hentet_tidspunkt[[:space:]]+INTO v_enheter_latest_fetched[[:space:]]+FROM reg\.enheter e[[:space:]]+WHERE e\.hentet_tidspunkt IS NOT NULL[[:space:]]+ORDER BY e\.hentet_tidspunkt DESC( NULLS LAST)?[[:space:]]+LIMIT 1;',
    'v_enheter_latest_fetched := public._admin_pg_stats_upper_timestamptz(''reg'', ''enheter'', ''hentet_tidspunkt'');',
    'g'
  );

  v_sql := regexp_replace(
    v_sql,
    'SELECT e\.oppdatert_tidspunkt[[:space:]]+INTO v_enheter_latest_updated[[:space:]]+FROM reg\.enheter e[[:space:]]+WHERE e\.oppdatert_tidspunkt IS NOT NULL[[:space:]]+ORDER BY e\.oppdatert_tidspunkt DESC( NULLS LAST)?[[:space:]]+LIMIT 1;',
    'v_enheter_latest_updated := public._admin_pg_stats_upper_timestamptz(''reg'', ''enheter'', ''oppdatert_tidspunkt'');',
    'g'
  );

  v_sql := regexp_replace(
    v_sql,
    'SELECT r\.regnskapsaar[[:space:]]+INTO v_regnskap_latest_year[[:space:]]+FROM reg\.regnskap r[[:space:]]+WHERE r\.regnskapsaar IS NOT NULL[[:space:]]+ORDER BY r\.regnskapsaar DESC( NULLS LAST)?[[:space:]]+LIMIT 1;',
    'v_regnskap_latest_year := public._admin_pg_stats_upper_integer(''reg'', ''regnskap'', ''regnskapsaar'');',
    'g'
  );

  v_sql := regexp_replace(
    v_sql,
    'SELECT s\.latest_regnskapsaar[[:space:]]+INTO v_regnskap_status_latest_year[[:space:]]+FROM reg\.regnskap_sync_status s[[:space:]]+WHERE s\.latest_regnskapsaar IS NOT NULL[[:space:]]+ORDER BY s\.latest_regnskapsaar DESC( NULLS LAST)?[[:space:]]+LIMIT 1;',
    'v_regnskap_status_latest_year := public._admin_pg_stats_upper_integer(''reg'', ''regnskap_sync_status'', ''latest_regnskapsaar'');',
    'g'
  );

  v_sql := regexp_replace(
    v_sql,
    'SELECT r\.hentet_tidspunkt[[:space:]]+INTO v_regnskap_latest_fetched[[:space:]]+FROM reg\.regnskap r[[:space:]]+WHERE r\.hentet_tidspunkt IS NOT NULL[[:space:]]+ORDER BY r\.hentet_tidspunkt DESC( NULLS LAST)?[[:space:]]+LIMIT 1;',
    'v_regnskap_latest_fetched := public._admin_pg_stats_upper_timestamptz(''reg'', ''regnskap'', ''hentet_tidspunkt'');',
    'g'
  );

  v_sql := regexp_replace(
    v_sql,
    'SELECT s\.last_success_at[[:space:]]+INTO v_status_latest_success[[:space:]]+FROM reg\.regnskap_sync_status s[[:space:]]+WHERE s\.last_success_at IS NOT NULL[[:space:]]+ORDER BY s\.last_success_at DESC( NULLS LAST)?[[:space:]]+LIMIT 1;',
    'v_status_latest_success := public._admin_pg_stats_upper_timestamptz(''reg'', ''regnskap_sync_status'', ''last_success_at'');',
    'g'
  );

  v_sql := regexp_replace(
    v_sql,
    'SELECT s\.last_checked_at[[:space:]]+INTO v_status_latest_checked[[:space:]]+FROM reg\.regnskap_sync_status s[[:space:]]+WHERE s\.last_checked_at IS NOT NULL[[:space:]]+ORDER BY s\.last_checked_at DESC( NULLS LAST)?[[:space:]]+LIMIT 1;',
    'v_status_latest_checked := public._admin_pg_stats_upper_timestamptz(''reg'', ''regnskap_sync_status'', ''last_checked_at'');',
    'g'
  );

  v_sql := regexp_replace(
    v_sql,
    'SELECT sp\.created_at[[:space:]]+INTO v_nav_latest_created[[:space:]]+FROM public\.source_postings sp[[:space:]]+WHERE sp\.source = ''nav''[[:space:]]+ORDER BY sp\.created_at DESC( NULLS LAST)?[[:space:]]+LIMIT 1;',
    'v_nav_latest_created := NULL::timestamptz;',
    'g'
  );

  v_sql := regexp_replace(
    v_sql,
    'SELECT sp\.last_seen_at[[:space:]]+INTO v_nav_latest_seen[[:space:]]+FROM public\.source_postings sp[[:space:]]+WHERE sp\.source = ''nav''[[:space:]]+AND sp\.last_seen_at IS NOT NULL[[:space:]]+ORDER BY sp\.last_seen_at DESC( NULLS LAST)?[[:space:]]+LIMIT 1;',
    'v_nav_latest_seen := NULL::timestamptz;',
    'g'
  );

  v_sql := replace(
    v_sql,
    '''latest_timestamps'', ''indexed_order_by_limit''',
    '''latest_timestamps'', ''pg_stats_histogram_upper_bound'''
  );

  IF v_sql ~ 'FROM reg\.enheter e[[:space:]]+WHERE e\.(hentet_tidspunkt|oppdatert_tidspunkt) IS NOT NULL[[:space:]]+ORDER BY' THEN
    RAISE EXCEPTION 'failed to remove reg.enheter latest timestamp scan from get_admin_ingestion_status';
  END IF;

  IF v_sql ~ 'FROM reg\.regnskap r[[:space:]]+WHERE r\.(hentet_tidspunkt|regnskapsaar) IS NOT NULL[[:space:]]+ORDER BY' THEN
    RAISE EXCEPTION 'failed to remove reg.regnskap latest lookup scan from get_admin_ingestion_status';
  END IF;

  IF v_sql ~ 'FROM reg\.regnskap_sync_status s[[:space:]]+WHERE s\.(latest_regnskapsaar|last_success_at|last_checked_at) IS NOT NULL[[:space:]]+ORDER BY' THEN
    RAISE EXCEPTION 'failed to remove reg.regnskap_sync_status latest lookup scan from get_admin_ingestion_status';
  END IF;

  IF v_sql ~ 'FROM public\.source_postings sp[[:space:]]+WHERE sp\.source = ''nav''[[:space:]]+(AND sp\.last_seen_at IS NOT NULL[[:space:]]+)?ORDER BY' THEN
    RAISE EXCEPTION 'failed to remove NAV source_postings latest lookup scan from get_admin_ingestion_status';
  END IF;

  IF v_sql NOT LIKE '%''latest_timestamps'', ''pg_stats_histogram_upper_bound''%' THEN
    RAISE EXCEPTION 'failed to update latest_timestamps strategy in get_admin_ingestion_status';
  END IF;

  EXECUTE v_sql;
END $$;

COMMENT ON FUNCTION public.get_admin_ingestion_status(integer, text) IS
  'Admin-only read model for Brreg/Regnskap/NAV ingestion counts. Ultrafast dashboard path; large-table latest timestamps use pg_stats histogram upper bounds; no mutations.';