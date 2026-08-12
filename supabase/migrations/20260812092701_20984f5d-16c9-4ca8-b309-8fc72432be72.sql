UPDATE public.employer_analysis_jobs
SET status = 'failed',
    error_message = 'Avbrutt manuelt: jobben hang i writing_company_row siden 2026-08-05',
    completed_at = now(),
    updated_at = now()
WHERE id = 'c7ceb04e-6d97-474f-ab78-528babc0ce20' AND status = 'processing';