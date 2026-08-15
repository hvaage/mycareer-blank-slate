
-- ===== Driftsvarsling: tilstand og hjerteslag =====
CREATE TABLE IF NOT EXISTS public.ops_alert_state (
  alert_key text PRIMARY KEY,
  source text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  title text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_notified_at timestamptz,
  notify_count integer NOT NULL DEFAULT 0,
  resolved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.ops_alert_state TO service_role;
GRANT SELECT ON public.ops_alert_state TO authenticated;
ALTER TABLE public.ops_alert_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins kan lese varslingstilstand" ON public.ops_alert_state;
CREATE POLICY "Admins kan lese varslingstilstand"
  ON public.ops_alert_state FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.ops_heartbeat (
  name text PRIMARY KEY,
  last_beat_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

GRANT ALL ON public.ops_heartbeat TO service_role;
GRANT SELECT ON public.ops_heartbeat TO authenticated;
ALTER TABLE public.ops_heartbeat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins kan lese hjerteslag" ON public.ops_heartbeat;
CREATE POLICY "Admins kan lese hjerteslag"
  ON public.ops_heartbeat FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ===== Samlet kjøringsbilde på tvers av kildene =====
CREATE OR REPLACE FUNCTION public.ops_sync_runs_unified()
RETURNS TABLE (source text, run_id text, started_at timestamptz, finished_at timestamptz, status text, error text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, reg
AS $$
  SELECT 'regnskap'::text, r.id::text, r.started_at, r.finished_at,
         CASE WHEN r.status = 'ok' THEN 'ok' ELSE r.status END,
         r.last_error
  FROM reg.regnskap_sync_runs r
  UNION ALL
  SELECT 'brreg_enheter', b.id::text, b.started_at, b.finished_at,
         CASE WHEN b.status = 'ok' THEN 'ok' ELSE b.status END,
         b.error
  FROM reg.brreg_full_sync_runs b
  UNION ALL
  SELECT 'nav', n.id::text, n.started_at, n.finished_at,
         COALESCE(n.meta->>'status', CASE WHEN n.error_summary IS NULL THEN 'ok' ELSE 'failed' END),
         n.error_summary
  FROM public.nav_sync_runs n
  UNION ALL
  SELECT 'careerjet', c.id::text, c.started_at, c.finished_at,
         CASE WHEN c.status = 'success' THEN 'ok' ELSE c.status END,
         c.error_summary
  FROM public.careerjet_sync_runs c
$$;

REVOKE ALL ON FUNCTION public.ops_sync_runs_unified() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_sync_runs_unified() TO service_role;

-- ===== Øyeblikksbilde for vaktjobben =====
CREATE OR REPLACE FUNCTION public.ops_watchdog_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, reg
SET statement_timeout = '60s'
AS $$
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
    'finished_at', b.finished_at
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
$$;

REVOKE ALL ON FUNCTION public.ops_watchdog_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_watchdog_snapshot() TO service_role;

-- ===== Reaper: marker hengte kjøringer som failed =====
CREATE OR REPLACE FUNCTION public.ops_reap_stuck_runs(p_source text, p_older_than_minutes integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, reg
SET statement_timeout = '60s'
AS $$
DECLARE
  cutoff timestamptz := now() - make_interval(mins => p_older_than_minutes);
  ids text[] := ARRAY[]::text[];
  msg text := format('Markert failed av vaktjobben: sto i running lenger enn %s minutter', p_older_than_minutes);
BEGIN
  IF p_source = 'regnskap' THEN
    WITH upd AS (
      UPDATE reg.regnskap_sync_runs SET status = 'failed', finished_at = now(),
        last_error = COALESCE(last_error, msg)
      WHERE finished_at IS NULL AND status = 'running' AND started_at < cutoff
      RETURNING id::text
    ) SELECT array_agg(id) INTO ids FROM upd;
  ELSIF p_source = 'careerjet' THEN
    WITH upd AS (
      UPDATE public.careerjet_sync_runs SET status = 'failed', finished_at = now(),
        error_summary = COALESCE(error_summary, msg)
      WHERE finished_at IS NULL AND status = 'running' AND started_at < cutoff
      RETURNING id::text
    ) SELECT array_agg(id) INTO ids FROM upd;
  ELSIF p_source = 'brreg_enheter' THEN
    WITH upd AS (
      UPDATE reg.brreg_full_sync_runs SET status = 'failed', finished_at = now(),
        error = COALESCE(error, msg)
      WHERE finished_at IS NULL AND status = 'running' AND started_at < cutoff
      RETURNING id::text
    ) SELECT array_agg(id) INTO ids FROM upd;
  ELSE
    RETURN jsonb_build_object('source', p_source, 'reaped', 0, 'ids', '[]'::jsonb, 'supported', false);
  END IF;

  RETURN jsonb_build_object(
    'source', p_source,
    'supported', true,
    'reaped', COALESCE(array_length(ids, 1), 0),
    'ids', to_jsonb(COALESCE(ids, ARRAY[]::text[]))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ops_reap_stuck_runs(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_reap_stuck_runs(text, integer) TO service_role;
