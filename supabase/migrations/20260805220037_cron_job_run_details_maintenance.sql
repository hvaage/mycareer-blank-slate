-- Cron run-detail maintenance helpers.
--
-- cron.job_run_details is operational extension history, not application
-- business data. pg_cron does not clean it automatically, and the target had
-- grown the table to the point where read-only diagnostics and job delivery
-- timed out. This migration does not delete rows automatically; it creates a
-- service_role-only batched prune function and replaces the regnskap admin
-- reader with a pkey-windowed query.

CREATE OR REPLACE FUNCTION public.cron_job_run_details_health()
RETURNS TABLE(
  max_runid bigint,
  approx_rows bigint,
  total_bytes bigint,
  table_bytes bigint,
  index_bytes bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (SELECT max(runid) FROM cron.job_run_details)::bigint AS max_runid,
    GREATEST(c.reltuples, 0)::bigint AS approx_rows,
    pg_total_relation_size('cron.job_run_details'::regclass)::bigint AS total_bytes,
    pg_relation_size('cron.job_run_details'::regclass)::bigint AS table_bytes,
    (pg_total_relation_size('cron.job_run_details'::regclass) - pg_relation_size('cron.job_run_details'::regclass))::bigint AS index_bytes
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'cron'
    AND c.relname = 'job_run_details';
$$;

REVOKE ALL ON FUNCTION public.cron_job_run_details_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_job_run_details_health() TO service_role;

CREATE OR REPLACE FUNCTION public.prune_cron_job_run_details(
  p_keep_latest integer DEFAULT 20000,
  p_batch_size integer DEFAULT 5000,
  p_max_batches integer DEFAULT 5
)
RETURNS TABLE(
  max_runid bigint,
  prune_before_runid bigint,
  deleted_count integer,
  batches integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_keep_latest integer := GREATEST(LEAST(COALESCE(p_keep_latest, 20000), 500000), 1000);
  v_batch_size integer := GREATEST(LEAST(COALESCE(p_batch_size, 5000), 20000), 1);
  v_max_batches integer := GREATEST(LEAST(COALESCE(p_max_batches, 5), 50), 1);
  v_max_runid bigint;
  v_prune_before bigint;
  v_batch_deleted integer;
  v_total_deleted integer := 0;
  v_batches integer := 0;
BEGIN
  SELECT max(runid) INTO v_max_runid
  FROM cron.job_run_details;

  IF v_max_runid IS NULL THEN
    RETURN QUERY SELECT NULL::bigint, NULL::bigint, 0::integer, 0::integer;
    RETURN;
  END IF;

  v_prune_before := GREATEST(v_max_runid - v_keep_latest, 0);

  IF v_prune_before <= 0 THEN
    RETURN QUERY SELECT v_max_runid, v_prune_before, 0::integer, 0::integer;
    RETURN;
  END IF;

  WHILE v_batches < v_max_batches LOOP
    WITH doomed AS (
      SELECT runid
      FROM cron.job_run_details
      WHERE runid < v_prune_before
      ORDER BY runid
      LIMIT v_batch_size
    )
    DELETE FROM cron.job_run_details d
    USING doomed
    WHERE d.runid = doomed.runid;

    GET DIAGNOSTICS v_batch_deleted = ROW_COUNT;
    v_total_deleted := v_total_deleted + v_batch_deleted;
    v_batches := v_batches + 1;

    EXIT WHEN v_batch_deleted = 0;
  END LOOP;

  RETURN QUERY SELECT v_max_runid, v_prune_before, v_total_deleted, v_batches;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_cron_job_run_details(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_cron_job_run_details(integer, integer, integer) TO service_role;

-- Replace the previous admin RPC that sorted cron.job_run_details by
-- start_time. On the bloated target that read timed out. This version inspects
-- only a bounded runid window and then filters to regnskap-sync-nightly.
CREATE OR REPLACE FUNCTION public.list_regnskap_cron_runs(p_limit integer DEFAULT 10)
RETURNS TABLE(
  runid bigint,
  jobid bigint,
  jobname text,
  status text,
  return_message text,
  start_time timestamptz,
  end_time timestamptz,
  duration_ms integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, cron, pg_temp
AS $$
DECLARE
  v_limit integer := GREATEST(LEAST(COALESCE(p_limit, 10), 100), 1);
  v_window integer := GREATEST(v_limit * 100, 1000);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH recent AS (
    SELECT d.runid, d.jobid, d.status, d.return_message, d.start_time, d.end_time
    FROM cron.job_run_details d
    ORDER BY d.runid DESC
    LIMIT v_window
  )
  SELECT
    r.runid,
    r.jobid,
    j.jobname,
    r.status,
    r.return_message,
    r.start_time,
    r.end_time,
    CASE WHEN r.end_time IS NOT NULL AND r.start_time IS NOT NULL
         THEN (EXTRACT(EPOCH FROM (r.end_time - r.start_time)) * 1000)::integer
         ELSE NULL END AS duration_ms
  FROM recent r
  JOIN cron.job j ON j.jobid = r.jobid
  WHERE j.jobname = 'regnskap-sync-nightly'
  ORDER BY r.runid DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.list_regnskap_cron_runs(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_regnskap_cron_runs(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.cron_job_run_details_health()
  IS 'Service-role read-only operational health for cron.job_run_details.';
COMMENT ON FUNCTION public.prune_cron_job_run_details(integer, integer, integer)
  IS 'Service-role batched prune for old pg_cron run history, keeping the newest runids.';
COMMENT ON FUNCTION public.list_regnskap_cron_runs(integer)
  IS 'Admin RPC for recent regnskap-sync cron delivery, bounded by runid to avoid full scans.';
