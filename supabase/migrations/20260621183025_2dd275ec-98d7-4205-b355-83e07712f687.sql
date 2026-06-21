
-- reset canary side repair-run to running with cursor right before the canary again
UPDATE public.nav_repair_runs
   SET status='running', cursor_after_external_id='0a2f6351-cc26-4851-afd6-4655576eb58e', finished_at=NULL
 WHERE id='6427bf50-9820-4295-b88e-d3f84d7a750c';

DO $$
DECLARE v_secret text; r bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='sync_nav_secret' LIMIT 1;
  SELECT net.http_post(
    url := 'https://miwzhbludgwvskmsfqnq.supabase.co/functions/v1/sync-nav-opportunities',
    headers := jsonb_build_object('Content-Type','application/json','x-sync-nav-secret', v_secret),
    body := jsonb_build_object('mode','repair_by_ids','repair_batch_size',1,'max_batches',1,'repair_run_id','6427bf50-9820-4295-b88e-d3f84d7a750c'),
    timeout_milliseconds := 120000
  ) INTO r;
END $$;
