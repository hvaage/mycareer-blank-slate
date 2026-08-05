-- Regnskap-sync cron delivery relief.
--
-- The catchup runner is healthy again, but pg_cron delivery on the
-- Lovable-managed target was unstable with */5 and no pg_net timeout override.
-- Keep the same job name and request body, reduce dispatcher pressure, avoid
-- the NAV/Careerjet collision minutes, and let pg_net wait long enough for the
-- Edge Function response.

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
  '13,28,43,58 * * * *',
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
        "scheduledBy": "pg_cron",
        "deliveryProfile": "relief_15m_offset"
      }
    }'::jsonb,
    timeout_milliseconds := 150000
  ) AS request_id;
  $job$
);