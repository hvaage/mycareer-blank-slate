ALTER TABLE public.job_match_evaluations
  DROP CONSTRAINT job_match_evaluations_job_lead_id_fkey;

ALTER TABLE public.job_match_evaluations
  ADD CONSTRAINT job_match_evaluations_job_lead_id_fkey
  FOREIGN KEY (job_lead_id) REFERENCES public.job_leads(id) ON DELETE CASCADE;

-- Rydd bort eventuelle foreldreløse rader fra tidligere feilslåtte flyttinger
DELETE FROM public.job_match_evaluations
WHERE row_kind = 'job_leads' AND job_lead_id IS NULL;