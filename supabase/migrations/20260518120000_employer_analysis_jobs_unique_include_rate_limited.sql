-- One non-terminal employer analysis row per user+company: include rate_limited so a new
-- queued row cannot be inserted while a cooldown job still exists (prevents parallel duplicates).

DROP INDEX IF EXISTS public.employer_analysis_jobs_one_active_per_user_company;

CREATE UNIQUE INDEX employer_analysis_jobs_one_active_per_user_company
  ON public.employer_analysis_jobs (user_id, company_id)
  WHERE status IN ('queued', 'processing', 'rate_limited');

NOTIFY pgrst, 'reload schema';
