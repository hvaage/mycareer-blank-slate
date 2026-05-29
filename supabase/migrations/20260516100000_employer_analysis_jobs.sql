-- Durable async employer (company) AI analysis jobs for PostgREST polling + Edge progress updates.

CREATE TYPE public.employer_analysis_job_status AS ENUM (
  'queued',
  'processing',
  'completed',
  'failed'
);

CREATE TABLE public.employer_analysis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  status public.employer_analysis_job_status NOT NULL DEFAULT 'queued',
  progress_percent smallint NOT NULL DEFAULT 0
    CHECK (progress_percent >= 0 AND progress_percent <= 100),
  current_step text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  artifact_document_id uuid REFERENCES public.documents (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_employer_analysis_jobs_user_created
  ON public.employer_analysis_jobs (user_id, created_at DESC);

CREATE INDEX idx_employer_analysis_jobs_company_created
  ON public.employer_analysis_jobs (company_id, created_at DESC);

CREATE UNIQUE INDEX employer_analysis_jobs_one_active_per_user_company
  ON public.employer_analysis_jobs (user_id, company_id)
  WHERE status IN ('queued', 'processing');

ALTER TABLE public.employer_analysis_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY employer_analysis_jobs_select_own
  ON public.employer_analysis_jobs
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE public.employer_analysis_jobs IS
  'Tracks analyze-company Edge runs: progress, failure, optional artifact document id.';

CREATE TRIGGER set_employer_analysis_jobs_updated_at
  BEFORE UPDATE ON public.employer_analysis_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT ON public.employer_analysis_jobs TO authenticated;

NOTIFY pgrst, 'reload schema';
