CREATE OR REPLACE FUNCTION public.ops_watchdog_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'reg'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  result jsonb;
  brreg jsonb;
BEGIN
  WITH runs AS (SELECT * FROM public.ops_sync_runs_unified()),
  ordered AS (
    SELECT r.*, row_number() OVER (PARTITION BY source ORDER BY started_at DESC) AS rn
    FROM runs r WHERE finished_at IS NOT NULL
  ),
  partials AS (
    SELECT source, count(*) AS streak
    FROM (
      SELECT o.*, sum(CASE WHEN status = 'partial' THEN 0 ELSE 1 END)
             OVER (PARTITION BY source ORDER BY rn) AS grp
      FROM ordered o
    ) s
    WHERE grp = 0
    GROUP BY source
  ),
  latest AS (SELECT * FROM ordered WHERE rn = 1),
  last_ok AS (
    SELECT source, max(finished_at) AS last_success_at
    FROM ordered WHERE status IN ('ok','empty') GROUP BY source
  ),
  stuck AS (
    SELECT source, count(*) AS stuck_count,
           min(started_at) AS oldest_started_at,
           (array_agg(run_id ORDER BY started_at))[1] AS oldest_run_id
    FROM runs
    WHERE finished_at IS NULL AND status = 'running'
    GROUP BY source
  ),
  srcs AS (SELECT unnest(ARRAY['regnskap','brreg_enheter','nav','careerjet']) AS source)
  SELECT jsonb_object_agg(s.source, jsonb_build_object(
    'last_success_at', lo.last_success_at,
    'last_run_at', l.finished_at,
    'last_status', l.status,
    'last_error', l.error,
    'last_run_id', l.run_id,
    'partial_streak', COALESCE(p.streak, 0),
    'running_count', COALESCE(st.stuck_count, 0),
    'running_oldest_started_at', st.oldest_started_at,
    'running_oldest_run_id', st.oldest_run_id
  ))
  INTO result
  FROM srcs s
  LEFT JOIN latest l ON l.source = s.source
  LEFT JOIN last_ok lo ON lo.source = s.source
  LEFT JOIN partials p ON p.source = s.source
  LEFT JOIN stuck st ON st.source = s.source;

  SELECT jsonb_build_object(
    'run_id', b.id,
    'status', b.status,
    'phase', b.phase,
    'gate_pass', b.gate_pass,
    'gate', b.gate,
    'rows_upserted', b.rows_upserted,
    'rows_missing', b.rows_missing,
    'started_at', b.started_at,
    'updated_at', b.updated_at,
    'finished_at', b.finished_at,
    'rows_seen', b.rows_seen,
    'rows_staged', b.rows_staged,
    'error', b.error
  ) INTO brreg
  FROM reg.brreg_full_sync_runs b
  ORDER BY b.started_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'now', now(),
    'sources', COALESCE(result, '{}'::jsonb),
    'brreg_last_run', COALESCE(brreg, 'null'::jsonb),
    'heartbeat', (SELECT to_jsonb(h) FROM public.ops_heartbeat h WHERE h.name = 'watchdog')
  );
END;
$function$;