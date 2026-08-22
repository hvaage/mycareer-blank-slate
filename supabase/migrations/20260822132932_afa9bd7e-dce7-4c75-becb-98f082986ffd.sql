CREATE TABLE IF NOT EXISTS public._tmp_5b_verification (step text, detail text);
TRUNCATE public._tmp_5b_verification;

DO $$
DECLARE
  v_user uuid;
  v_id uuid;
  r record;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;

  -- A: status='utfort' skal sette completed og completed_at
  INSERT INTO public.next_steps (user_id, title, activity_type, activity_scope, status)
  VALUES (v_user, 'TMP verifikasjon A', 'samtale', 'personal', 'utfort')
  RETURNING id INTO v_id;
  SELECT status, completed, completed_at IS NOT NULL AS has_ts INTO r FROM public.next_steps WHERE id = v_id;
  INSERT INTO public._tmp_5b_verification VALUES ('A utfort=>completed', format('status=%s completed=%s completed_at=%s', r.status, r.completed, r.has_ts));

  -- B: tilbake til planlagt skal nullstille
  UPDATE public.next_steps SET status='planlagt' WHERE id=v_id;
  SELECT status, completed, completed_at IS NULL AS cleared INTO r FROM public.next_steps WHERE id=v_id;
  INSERT INTO public._tmp_5b_verification VALUES ('B planlagt nullstiller', format('status=%s completed=%s completed_at_cleared=%s', r.status, r.completed, r.cleared));

  -- C: completed=true skal sette status='utfort'
  UPDATE public.next_steps SET completed=true WHERE id=v_id;
  SELECT status, completed, completed_at IS NOT NULL AS has_ts INTO r FROM public.next_steps WHERE id=v_id;
  INSERT INTO public._tmp_5b_verification VALUES ('C completed=>utfort', format('status=%s completed=%s completed_at=%s', r.status, r.completed, r.has_ts));

  -- D: avlyst er verken åpen eller utført
  UPDATE public.next_steps SET status='avlyst' WHERE id=v_id;
  SELECT status, completed, completed_at IS NULL AS cleared INTO r FROM public.next_steps WHERE id=v_id;
  INSERT INTO public._tmp_5b_verification VALUES ('D avlyst', format('status=%s completed=%s completed_at_cleared=%s', r.status, r.completed, r.cleared));

  DELETE FROM public.next_steps WHERE id=v_id;

  -- E: kontekstvalidering i RPC (ingen kontekst, scope=activity)
  INSERT INTO public._tmp_5b_verification
  SELECT 'E rpc uten kontekst', (public.network_upsert_activity(v_user, NULL, 'TMP uten kontekst', NULL, NULL, NULL, 'samtale', 'planlagt', NULL, 'activity', NULL, NULL, NULL, NULL))::text;
END $$;
