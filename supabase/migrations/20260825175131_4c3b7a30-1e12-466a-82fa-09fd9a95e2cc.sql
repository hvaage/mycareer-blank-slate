ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS application_due timestamptz;

UPDATE public.job_leads SET posted_text = NULL WHERE length(coalesce(posted_text,'')) > 300;
UPDATE public.applications SET posted_text = NULL WHERE length(coalesce(posted_text,'')) > 300;