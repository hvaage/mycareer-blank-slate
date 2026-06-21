
-- 1) Global target writer-lease table (singleton row per lease_name)
CREATE TABLE IF NOT EXISTS public.nav_target_writer_leases (
  lease_name text PRIMARY KEY,
  run_id uuid NOT NULL,
  mode text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

GRANT ALL ON public.nav_target_writer_leases TO service_role;
ALTER TABLE public.nav_target_writer_leases ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role bypasses RLS. authenticated/anon are denied.

-- 2) Lease claim (atomic, with stale-takeover after expires_at)
CREATE OR REPLACE FUNCTION public.nav_target_lease_claim(
  p_lease_name text,
  p_run_id uuid,
  p_mode text,
  p_ttl_seconds integer DEFAULT 180
) RETURNS TABLE(claimed boolean, current_run_id uuid, current_mode text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.nav_target_writer_leases%ROWTYPE;
BEGIN
  -- Try insert; if conflict, try takeover when stale or same run_id
  INSERT INTO public.nav_target_writer_leases AS l (lease_name, run_id, mode, acquired_at, heartbeat_at, expires_at)
  VALUES (p_lease_name, p_run_id, p_mode, now(), now(), now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (lease_name) DO UPDATE
    SET run_id = EXCLUDED.run_id,
        mode = EXCLUDED.mode,
        acquired_at = EXCLUDED.acquired_at,
        heartbeat_at = EXCLUDED.heartbeat_at,
        expires_at = EXCLUDED.expires_at
    WHERE l.run_id = EXCLUDED.run_id OR l.expires_at < now()
  RETURNING * INTO r;
  IF r.run_id IS NOT NULL THEN
    RETURN QUERY SELECT true, r.run_id, r.mode, r.expires_at;
    RETURN;
  END IF;
  SELECT * INTO r FROM public.nav_target_writer_leases WHERE lease_name = p_lease_name;
  RETURN QUERY SELECT false, r.run_id, r.mode, r.expires_at;
END $$;

REVOKE ALL ON FUNCTION public.nav_target_lease_claim(text, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nav_target_lease_claim(text, uuid, text, integer) TO service_role;

-- 3) Heartbeat: only update if we still own the lease
CREATE OR REPLACE FUNCTION public.nav_target_lease_heartbeat(
  p_lease_name text, p_run_id uuid, p_ttl_seconds integer DEFAULT 180
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE public.nav_target_writer_leases
     SET heartbeat_at = now(),
         expires_at = now() + make_interval(secs => p_ttl_seconds)
   WHERE lease_name = p_lease_name AND run_id = p_run_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;
REVOKE ALL ON FUNCTION public.nav_target_lease_heartbeat(text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nav_target_lease_heartbeat(text, uuid, integer) TO service_role;

-- 4) Release: compare-and-set on run_id
CREATE OR REPLACE FUNCTION public.nav_target_lease_release(
  p_lease_name text, p_run_id uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.nav_target_writer_leases WHERE lease_name = p_lease_name AND run_id = p_run_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;
REVOKE ALL ON FUNCTION public.nav_target_lease_release(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nav_target_lease_release(text, uuid) TO service_role;

-- 5) Admin status read (no secrets)
CREATE OR REPLACE FUNCTION public.nav_target_lease_status()
RETURNS TABLE(lease_name text, run_id uuid, mode text, acquired_at timestamptz, heartbeat_at timestamptz, expires_at timestamptz, is_stale boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT l.lease_name, l.run_id, l.mode, l.acquired_at, l.heartbeat_at, l.expires_at, (l.expires_at < now())
      FROM public.nav_target_writer_leases l
     ORDER BY l.acquired_at DESC;
END $$;
GRANT EXECUTE ON FUNCTION public.nav_target_lease_status() TO authenticated;

-- 6) Admin: status of the temporary repair cron job
CREATE OR REPLACE FUNCTION public.get_nav_repair_cron_info()
RETURNS TABLE(jobname text, schedule text, active boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, cron, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT j.jobname::text, j.schedule::text, j.active
      FROM cron.job j
     WHERE j.jobname = 'nav-target-repair-3min'
     LIMIT 1;
END $$;
GRANT EXECUTE ON FUNCTION public.get_nav_repair_cron_info() TO authenticated;

-- 7) Cron dispatcher: dispatches a repair batch or auto-unschedules itself.
--    SECURITY DEFINER, no EXECUTE for PUBLIC/anon/authenticated. Reads
--    sync_nav_secret from Vault and forwards via x-sync-nav-secret header.
CREATE OR REPLACE FUNCTION public.nav_target_repair_tick()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, net, pg_temp AS $$
DECLARE
  v_secret text;
  v_active uuid;
  v_request bigint;
BEGIN
  SELECT id INTO v_active FROM public.nav_repair_runs
   WHERE status = 'running' ORDER BY started_at DESC LIMIT 1;
  IF v_active IS NULL THEN
    BEGIN
      PERFORM cron.unschedule('nav-target-repair-3min');
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RETURN jsonb_build_object('action','unscheduled','reason','no_active_repair_run');
  END IF;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'sync_nav_secret' LIMIT 1;
  IF v_secret IS NULL OR length(v_secret) = 0 THEN
    RETURN jsonb_build_object('action','skipped','reason','vault_secret_missing');
  END IF;
  SELECT net.http_post(
    url := 'https://miwzhbludgwvskmsfqnq.supabase.co/functions/v1/sync-nav-opportunities',
    headers := jsonb_build_object('Content-Type','application/json','x-sync-nav-secret', v_secret),
    body := jsonb_build_object('mode','repair_by_ids','repair_batch_size',100,'max_batches',2),
    timeout_milliseconds := 150000
  ) INTO v_request;
  RETURN jsonb_build_object('action','dispatched','request_id', v_request, 'repair_run_id', v_active);
END $$;
REVOKE ALL ON FUNCTION public.nav_target_repair_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nav_target_repair_tick() TO service_role;

-- 8) (Re)schedule the temporary repair cron every 3 minutes
DO $$ BEGIN PERFORM cron.unschedule('nav-target-repair-3min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'nav-target-repair-3min',
  '*/3 * * * *',
  $cmd$ SELECT public.nav_target_repair_tick(); $cmd$
);
