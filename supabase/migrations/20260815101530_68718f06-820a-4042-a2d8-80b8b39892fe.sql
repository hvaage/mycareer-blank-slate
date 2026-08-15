
DO $$
DECLARE v_cmd text; v_sched text;
BEGIN
  SELECT command, schedule INTO v_cmd, v_sched FROM cron.job WHERE jobname = 'regnskap-sync-nightly';
  IF v_cmd IS NULL THEN RETURN; END IF;
  PERFORM cron.unschedule('regnskap-sync-nightly');
  PERFORM cron.schedule('regnskap-sync-15min', v_sched, v_cmd);
END $$;
