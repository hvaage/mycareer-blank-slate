
DO $$
DECLARE
  v_secret text;
  req_cursor bigint;
  req_repair bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='sync_nav_secret' LIMIT 1;
  IF v_secret IS NULL THEN RAISE EXCEPTION 'no secret'; END IF;

  -- Fire repair first, then cursor immediately after (sub-ms gap).
  SELECT net.http_post(
    url := 'https://miwzhbludgwvskmsfqnq.supabase.co/functions/v1/sync-nav-opportunities',
    headers := jsonb_build_object('Content-Type','application/json','x-sync-nav-secret', v_secret),
    body := jsonb_build_object('mode','repair_by_ids','repair_batch_size',50,'max_batches',1),
    timeout_milliseconds := 150000
  ) INTO req_repair;

  SELECT net.http_post(
    url := 'https://miwzhbludgwvskmsfqnq.supabase.co/functions/v1/sync-nav-opportunities',
    headers := jsonb_build_object('Content-Type','application/json','x-sync-nav-secret', v_secret),
    body := jsonb_build_object('mode','cursor'),
    timeout_milliseconds := 150000
  ) INTO req_cursor;

  RAISE NOTICE 'INTEG_TEST repair_req=% cursor_req=%', req_repair, req_cursor;
END $$;
