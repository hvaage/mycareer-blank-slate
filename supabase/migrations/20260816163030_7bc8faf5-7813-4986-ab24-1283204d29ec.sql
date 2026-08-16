-- Fase 2c: public.cv_generation_jobs. RLS på, ingen policyer, ingen Data API-tilgang.

CREATE TABLE public.cv_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  document_group_id uuid NOT NULL,
  job_kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  priority smallint NOT NULL DEFAULT 500,
  profile_id uuid REFERENCES ai.model_profiles(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES public.user_opportunities(id) ON DELETE SET NULL,
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_payload jsonb,
  step_budget_ms integer NOT NULL DEFAULT 90000,
  lease_seconds integer NOT NULL DEFAULT 180,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  locked_at timestamptz,
  lease_expires_at timestamptz,
  model_run_id uuid REFERENCES ai.model_runs(id) ON DELETE SET NULL,
  error_code text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT cv_generation_jobs_kind_check CHECK (job_kind IN ('generate_general_cv','generate_tailored_cv','regenerate_section','review_proposals')),
  CONSTRAINT cv_generation_jobs_status_check CHECK (status IN ('queued','running','waiting_review','succeeded','failed','cancelled')),
  CONSTRAINT cv_generation_jobs_priority_check CHECK (priority BETWEEN 0 AND 1000),
  CONSTRAINT cv_generation_jobs_budget_check CHECK (step_budget_ms BETWEEN 1000 AND 600000),
  -- Lease er minst to ganger stegets tidsbudsjett.
  CONSTRAINT cv_generation_jobs_lease_budget_check CHECK (lease_seconds * 1000 >= 2 * step_budget_ms),
  CONSTRAINT cv_generation_jobs_max_attempts_check CHECK (max_attempts BETWEEN 1 AND 10),
  CONSTRAINT cv_generation_jobs_attempt_check CHECK (attempt_count >= 0 AND attempt_count <= max_attempts + 1),
  CONSTRAINT cv_generation_jobs_input_obj CHECK (jsonb_typeof(input_payload) = 'object'),
  CONSTRAINT cv_generation_jobs_lease_state_check CHECK (
    (status = 'running') = (locked_by IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT cv_generation_jobs_terminal_finished CHECK (
    (status IN ('succeeded','failed','cancelled')) = (finished_at IS NOT NULL)
  ),
  CONSTRAINT cv_generation_jobs_tailored_needs_opportunity CHECK (
    job_kind <> 'generate_tailored_cv' OR opportunity_id IS NOT NULL
  )
);

-- Én aktiv jobb per bruker + dokumentgruppe.
CREATE UNIQUE INDEX cv_generation_jobs_active_unique
  ON public.cv_generation_jobs(user_id, document_group_id)
  WHERE status IN ('queued','running','waiting_review');

CREATE INDEX cv_generation_jobs_queue_idx
  ON public.cv_generation_jobs(priority, run_after) WHERE status = 'queued';
CREATE INDEX cv_generation_jobs_lease_idx
  ON public.cv_generation_jobs(lease_expires_at) WHERE status = 'running';
CREATE INDEX cv_generation_jobs_user_idx ON public.cv_generation_jobs(user_id, created_at DESC);
CREATE INDEX cv_generation_jobs_group_idx ON public.cv_generation_jobs(document_group_id);
CREATE INDEX cv_generation_jobs_profile_idx ON public.cv_generation_jobs(profile_id) WHERE profile_id IS NOT NULL;
CREATE INDEX cv_generation_jobs_opportunity_idx ON public.cv_generation_jobs(opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX cv_generation_jobs_model_run_idx ON public.cv_generation_jobs(model_run_id) WHERE model_run_id IS NOT NULL;

ALTER TABLE public.cv_generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cv_generation_jobs FORCE ROW LEVEL SECURITY;

-- Ingen policyer og ingen grants til anon/authenticated: ingen direkte Data API-tilgang.
REVOKE ALL ON public.cv_generation_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cv_generation_jobs TO service_role;

COMMENT ON TABLE public.cv_generation_jobs IS 'Jobbkø for CV-generering. Ingen Data API-tilgang: frontend leser sanitert status via Edge Function -> public.internal_ai_* RPC.';