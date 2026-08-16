-- Fase 2b: privat ai-schema. Ikke eksponert via Data API. Ingen grants til anon/authenticated.

CREATE SCHEMA IF NOT EXISTS ai;

REVOKE ALL ON SCHEMA ai FROM PUBLIC;
REVOKE ALL ON SCHEMA ai FROM anon, authenticated;
GRANT USAGE ON SCHEMA ai TO service_role;

-- ---------------------------------------------------------------- profiles
CREATE TABLE ai.model_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_key text NOT NULL UNIQUE,
  task_key text NOT NULL,
  model_id text NOT NULL,
  prompt_version text NOT NULL,
  max_tokens integer NOT NULL,
  request_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_tier text NOT NULL DEFAULT 'standard',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT model_profiles_max_tokens_check CHECK (max_tokens > 0 AND max_tokens <= 200000),
  CONSTRAINT model_profiles_cost_tier_check CHECK (cost_tier IN ('cheap','standard','expensive')),
  CONSTRAINT model_profiles_request_options_obj CHECK (jsonb_typeof(request_options) = 'object'),
  CONSTRAINT model_profiles_capabilities_obj CHECK (jsonb_typeof(capabilities) = 'object')
);
CREATE INDEX model_profiles_task_active_idx ON ai.model_profiles(task_key) WHERE is_active;

-- ---------------------------------------------------------------- pricing
CREATE TABLE ai.model_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id text NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  input_per_mtok numeric(12,6) NOT NULL,
  output_per_mtok numeric(12,6) NOT NULL,
  cache_read_per_mtok numeric(12,6),
  cache_write_per_mtok numeric(12,6),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT model_pricing_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT model_pricing_input_check CHECK (input_per_mtok >= 0),
  CONSTRAINT model_pricing_output_check CHECK (output_per_mtok >= 0),
  CONSTRAINT model_pricing_cache_read_check CHECK (cache_read_per_mtok IS NULL OR cache_read_per_mtok >= 0),
  CONSTRAINT model_pricing_cache_write_check CHECK (cache_write_per_mtok IS NULL OR cache_write_per_mtok >= 0),
  CONSTRAINT model_pricing_validity_check CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX model_pricing_model_idx ON ai.model_pricing(model_id, valid_from DESC);

-- ---------------------------------------------------------------- audit
CREATE TABLE ai.model_profile_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES ai.model_profiles(id) ON DELETE CASCADE,
  changed_by uuid,
  change_kind text NOT NULL,
  before_snapshot jsonb,
  after_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT model_profile_audit_kind_check CHECK (change_kind IN ('create','update','activate','deactivate','delete'))
);
CREATE INDEX model_profile_audit_profile_idx ON ai.model_profile_audit(profile_id, created_at DESC);

-- ---------------------------------------------------------------- runs
CREATE TABLE ai.model_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id uuid NOT NULL,
  user_id uuid,
  job_id uuid,
  profile_id uuid REFERENCES ai.model_profiles(id) ON DELETE SET NULL,
  profile_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  task_key text NOT NULL,
  model_id text NOT NULL,
  api_version text,
  request_id text,
  status text NOT NULL DEFAULT 'queued',
  outcome text,
  error_code text,
  http_status integer,
  retry_count integer NOT NULL DEFAULT 0,
  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cache_write_tokens integer,
  cost_usd numeric(12,6),
  duration_ms integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT model_runs_status_check CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  CONSTRAINT model_runs_outcome_check CHECK (outcome IS NULL OR outcome IN ('ok','provider_error','timeout','invalid_output','cancelled')),
  CONSTRAINT model_runs_http_status_check CHECK (http_status IS NULL OR (http_status BETWEEN 100 AND 599)),
  CONSTRAINT model_runs_retry_check CHECK (retry_count >= 0 AND retry_count <= 10),
  CONSTRAINT model_runs_input_tokens_check CHECK (input_tokens IS NULL OR input_tokens >= 0),
  CONSTRAINT model_runs_output_tokens_check CHECK (output_tokens IS NULL OR output_tokens >= 0),
  CONSTRAINT model_runs_cache_read_check CHECK (cache_read_tokens IS NULL OR cache_read_tokens >= 0),
  CONSTRAINT model_runs_cache_write_check CHECK (cache_write_tokens IS NULL OR cache_write_tokens >= 0),
  CONSTRAINT model_runs_cost_check CHECK (cost_usd IS NULL OR cost_usd >= 0),
  CONSTRAINT model_runs_duration_check CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CONSTRAINT model_runs_snapshot_obj CHECK (jsonb_typeof(profile_snapshot) = 'object'),
  CONSTRAINT model_runs_terminal_finished CHECK (
    (status IN ('succeeded','failed','cancelled')) = (finished_at IS NOT NULL)
  )
);
CREATE INDEX model_runs_correlation_idx ON ai.model_runs(correlation_id);
CREATE INDEX model_runs_job_idx ON ai.model_runs(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX model_runs_user_idx ON ai.model_runs(user_id, started_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX model_runs_profile_idx ON ai.model_runs(profile_id);
CREATE INDEX model_runs_running_idx ON ai.model_runs(started_at) WHERE status = 'running';

-- ---------------------------------------------------------------- eval
CREATE TABLE ai.eval_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_key text NOT NULL UNIQUE,
  task_key text NOT NULL,
  description text,
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eval_cases_input_obj CHECK (jsonb_typeof(input_payload) = 'object')
);
CREATE INDEX eval_cases_task_idx ON ai.eval_cases(task_key) WHERE is_active;

CREATE TABLE ai.eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key text NOT NULL UNIQUE,
  task_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  skill_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT eval_runs_status_check CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  CONSTRAINT eval_runs_skill_versions_obj CHECK (jsonb_typeof(skill_versions) = 'object'),
  CONSTRAINT eval_runs_terminal_finished CHECK (
    (status IN ('succeeded','failed','cancelled')) = (finished_at IS NOT NULL)
  )
);
CREATE INDEX eval_runs_status_idx ON ai.eval_runs(status, created_at DESC);

CREATE TABLE ai.eval_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  eval_run_id uuid NOT NULL REFERENCES ai.eval_runs(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES ai.eval_cases(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES ai.model_profiles(id) ON DELETE RESTRICT,
  profile_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  priority smallint NOT NULL DEFAULT 500,
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
  CONSTRAINT eval_jobs_unique_identity UNIQUE (eval_run_id, case_id, profile_id),
  CONSTRAINT eval_jobs_status_check CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  CONSTRAINT eval_jobs_attempt_check CHECK (attempt_count >= 0 AND attempt_count <= max_attempts + 1),
  CONSTRAINT eval_jobs_max_attempts_check CHECK (max_attempts BETWEEN 1 AND 10),
  CONSTRAINT eval_jobs_priority_check CHECK (priority BETWEEN 0 AND 1000),
  CONSTRAINT eval_jobs_snapshot_obj CHECK (jsonb_typeof(profile_snapshot) = 'object'),
  CONSTRAINT eval_jobs_lease_check CHECK ((status = 'running') = (lease_expires_at IS NOT NULL AND locked_by IS NOT NULL)),
  CONSTRAINT eval_jobs_terminal_finished CHECK (
    (status IN ('succeeded','failed','cancelled')) = (finished_at IS NOT NULL)
  )
);
CREATE INDEX eval_jobs_queue_idx ON ai.eval_jobs(priority, run_after) WHERE status = 'queued';
CREATE INDEX eval_jobs_lease_idx ON ai.eval_jobs(lease_expires_at) WHERE status = 'running';
CREATE INDEX eval_jobs_run_idx ON ai.eval_jobs(eval_run_id);
CREATE INDEX eval_jobs_case_idx ON ai.eval_jobs(case_id);
CREATE INDEX eval_jobs_profile_idx ON ai.eval_jobs(profile_id);
CREATE INDEX eval_jobs_model_run_idx ON ai.eval_jobs(model_run_id) WHERE model_run_id IS NOT NULL;

CREATE TABLE ai.eval_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  eval_job_id uuid NOT NULL REFERENCES ai.eval_jobs(id) ON DELETE CASCADE,
  metric_key text NOT NULL,
  score numeric(6,3) NOT NULL,
  max_score numeric(6,3) NOT NULL DEFAULT 1,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eval_scores_unique UNIQUE (eval_job_id, metric_key),
  CONSTRAINT eval_scores_range_check CHECK (score >= 0 AND score <= max_score),
  CONSTRAINT eval_scores_max_check CHECK (max_score > 0),
  CONSTRAINT eval_scores_detail_obj CHECK (jsonb_typeof(detail) = 'object')
);
CREATE INDEX eval_scores_job_idx ON ai.eval_scores(eval_job_id);
CREATE INDEX eval_scores_metric_idx ON ai.eval_scores(metric_key);

-- Ingen grants til anon/authenticated. Kun service_role.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ai TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ai GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;