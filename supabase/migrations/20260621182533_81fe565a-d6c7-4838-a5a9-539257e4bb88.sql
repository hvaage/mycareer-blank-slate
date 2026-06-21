
-- 1) Pause repair cron immediately; nav-sync-30min stays untouched.
DO $$
BEGIN
  PERFORM cron.unschedule('nav-target-repair-3min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 2) Deterministic lease RPC tests (as postgres). Cleans up its own rows.
DO $$
DECLARE
  A uuid := '11111111-1111-1111-1111-111111111111';
  B uuid := '22222222-2222-2222-2222-222222222222';
  L text := 'nav_target_writer_accept_test';
  r_a record; r_b record; r_takeover record;
  hb_wrong boolean; rel_wrong boolean; rel_right boolean;
BEGIN
  -- cleanup leftover
  DELETE FROM public.nav_target_writer_leases WHERE lease_name = L;

  SELECT * INTO r_a FROM public.nav_target_lease_claim(L, A, 'cursor', 60);
  SELECT * INTO r_b FROM public.nav_target_lease_claim(L, B, 'repair_by_ids', 60);
  hb_wrong := public.nav_target_lease_heartbeat(L, B, 60);
  rel_wrong := public.nav_target_lease_release(L, B);
  rel_right := public.nav_target_lease_release(L, A);

  RAISE NOTICE 'LEASE_TEST claim_A=% claim_B=% hb_wrong=% rel_wrong=% rel_right=%',
    r_a.claimed, r_b.claimed, hb_wrong, rel_wrong, rel_right;

  -- Stale takeover: claim A with 1s TTL, sleep past expiry, then B can take it.
  DELETE FROM public.nav_target_writer_leases WHERE lease_name = L;
  PERFORM public.nav_target_lease_claim(L, A, 'cursor', 1);
  -- force expire by hand instead of pg_sleep
  UPDATE public.nav_target_writer_leases SET expires_at = now() - interval '1 second' WHERE lease_name = L;
  SELECT * INTO r_takeover FROM public.nav_target_lease_claim(L, B, 'repair_by_ids', 60);
  RAISE NOTICE 'LEASE_TEST stale_takeover=%', r_takeover.claimed;

  DELETE FROM public.nav_target_writer_leases WHERE lease_name = L;
END $$;
