
DO $$
DECLARE
  v_secret text;
  r1 bigint; r2 bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='sync_nav_secret' LIMIT 1;
  SELECT net.http_post(
    url := 'https://miwzhbludgwvskmsfqnq.supabase.co/functions/v1/sync-nav-opportunities',
    headers := jsonb_build_object('Content-Type','application/json','x-sync-nav-secret', v_secret),
    body := jsonb_build_object('mode','repair_by_ids','repair_batch_size',1,'max_batches',1,'repair_run_id','6427bf50-9820-4295-b88e-d3f84d7a750c'),
    timeout_milliseconds := 120000
  ) INTO r1;
  RAISE NOTICE 'CANARY_INVOKE_1 req=%', r1;
END $$;
