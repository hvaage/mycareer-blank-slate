ALTER TYPE public.employer_analysis_job_status ADD VALUE IF NOT EXISTS 'rate_limited';

ALTER TABLE public.employer_analysis_jobs
  ADD COLUMN IF NOT EXISTS retry_after_at timestamptz;

COMMENT ON COLUMN public.employer_analysis_jobs.retry_after_at IS
  'When status is rate_limited, earliest recommended client retry (from Retry-After or default backoff).';