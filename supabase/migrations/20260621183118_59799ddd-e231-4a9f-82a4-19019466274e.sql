
UPDATE public.nav_repair_runs
   SET status='completed', finished_at=now(), meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('completed_by','acceptance_canary')
 WHERE id='6427bf50-9820-4295-b88e-d3f84d7a750c';

SELECT cron.schedule(
  'nav-target-repair-3min',
  '*/3 * * * *',
  $$SELECT public.nav_target_repair_tick();$$
);
