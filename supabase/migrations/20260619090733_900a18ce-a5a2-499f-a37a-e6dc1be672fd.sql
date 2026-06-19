DO $$
DECLARE existing_id uuid;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name = 'sync_nav_secret';
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret('Syncnavsecreteretpassordsomjegvelgerselv', 'sync_nav_secret', 'Auth header for pg_cron -> sync-nav-opportunities');
  ELSE
    PERFORM vault.update_secret(existing_id, 'Syncnavsecreteretpassordsomjegvelgerselv');
  END IF;
END
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('nav-sync-30min');
EXCEPTION WHEN OTHERS THEN NULL;
END
$$;

SELECT cron.schedule(
  'nav-sync-30min',
  '*/30 * * * *',
  $cmd$
    SELECT net.http_post(
      url := 'https://miwzhbludgwvskmsfqnq.supabase.co/functions/v1/sync-nav-opportunities',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-nav-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sync_nav_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000
    );
  $cmd$
);