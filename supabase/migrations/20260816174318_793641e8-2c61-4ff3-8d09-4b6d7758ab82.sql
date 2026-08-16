INSERT INTO public.cv_generation_jobs
  (user_id, document_group_id, job_kind, status, input_payload, step_budget_ms, lease_seconds, max_attempts, priority)
SELECT '8103b452-0a27-46b0-a204-e2d9db34ec22',
       gen_random_uuid(), 'review_proposals', 'queued',
       jsonb_build_object('preflight', true, 'sleep_ms', s.ms, 'tag', 'phase4a'),
       120000, 300, 3, 100
FROM (VALUES (0),(0),(90000)) AS s(ms);