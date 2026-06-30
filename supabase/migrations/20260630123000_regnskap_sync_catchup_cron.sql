-- Accelerate Regnskapsregisteret catchup for companies missing local accounts.
--
-- Goal: reach "minimum one accounting year mirrored" quickly without changing
-- the Edge Function runner or fetching optional PDF-year metadata during the
-- catchup phase.
--
-- The existing job name is retained so admin RPCs/UI that inspect
-- regnskap-sync-nightly keep working.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'regnskap-sync-nightly';

  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule('regnskap-sync-nightly');
  END IF;
END $$;

SELECT cron.schedule(
  'regnskap-sync-nightly',
  '*/5 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://miwzhbludgwvskmsfqnq.supabase.co/functions/v1/regnskap-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'regnskap_sync_cron_secret')
    ),
    body := '{
      "op": "run",
      "mode": "due",
      "limit": 60,
      "rps": 2,
      "timeBudgetMs": 55000,
      "includePdfYears": false,
      "meta": {
        "profile": "catchup_min_1_year",
        "scheduledBy": "pg_cron"
      }
    }'::jsonb
  ) AS request_id;
  $job$
);
