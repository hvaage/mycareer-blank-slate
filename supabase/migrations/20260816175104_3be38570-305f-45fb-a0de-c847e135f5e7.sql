DO $$
DECLARE jid uuid; st text; att int; res jsonb; ec text;
BEGIN
  INSERT INTO public.cv_generation_jobs
    (user_id, document_group_id, job_kind, status, input_payload, step_budget_ms, lease_seconds,
     max_attempts, attempt_count, priority, locked_by, locked_at, lease_expires_at)
  VALUES ('8103b452-0a27-46b0-a204-e2d9db34ec22', gen_random_uuid(), 'review_proposals', 'running',
     jsonb_build_object('preflight', true, 'tag','phase4a_reaper'), 20000, 40, 1, 1, 50,
     'worker_dead', now() - interval '5 minutes', now() - interval '2 minutes')
  RETURNING id INTO jid;

  res := public.internal_ai_reap_stale_jobs(10);
  SELECT status, attempt_count, error_code INTO st, att, ec
    FROM public.cv_generation_jobs WHERE id = jid;
  IF st <> 'failed' THEN
    RAISE EXCEPTION 'reaper ga status % (forventet failed), res=%', st, res;
  END IF;
  IF ec IS NULL THEN RAISE EXCEPTION 'reaper satte ingen feilkode'; END IF;
  RAISE NOTICE 'reaper OK status=% attempts=% code=% res=%', st, att, ec, res;

  DELETE FROM public.cv_generation_jobs WHERE input_payload->>'tag' LIKE 'phase4a%';
END $$;