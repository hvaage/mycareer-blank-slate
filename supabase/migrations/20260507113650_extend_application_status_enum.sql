-- Norwegian pipeline labels used by public.applications (additive).
-- Original application_status (06133008) keeps legacy values for public.job_applications.
-- public.søknad_generert is added later (AFTER identifisert) in 20260507160859 — do not add here.

ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'identifisert';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'søknad_sendt';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'screening';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'intervju_1';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'intervju_2';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'intervju_3';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'intervju_4';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'case_study';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'candidate_profiling';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'tilbud_mottatt';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'avsluttet';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'trukket';
