select cron.alter_job(39, command := $c$
  select net.http_post(
    url := 'https://project--4cf3d398-92d8-4618-910c-9be52ac97cf5-dev.lovable.app/api/public/linkedin/worker?action=run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'LINKEDIN_IMPORT_WORKER_SECRET')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$c$);
select cron.alter_job(40, command := $c$
  select net.http_post(
    url := 'https://project--4cf3d398-92d8-4618-910c-9be52ac97cf5-dev.lovable.app/api/public/linkedin/worker?action=reap',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'LINKEDIN_IMPORT_WORKER_SECRET')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$c$);