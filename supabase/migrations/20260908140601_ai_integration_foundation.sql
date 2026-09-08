-- Felles AI-integrasjonsfundament for Grok, Claude, ChatGPT/Codex og Gemini.
-- Leverandørene er likestilte adaptere mot samme backendkontrakt.

ALTER TABLE public.email_job_sources
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS email_job_sources_one_forwarding_per_user_idx
  ON public.email_job_sources (user_id)
  WHERE intake_mode = 'forwarding';

CREATE TABLE public.ai_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  declared_plan_tier text NOT NULL DEFAULT 'unknown',
  effective_mode text NOT NULL DEFAULT 'guided',
  status text NOT NULL DEFAULT 'draft',
  email_job_source_id uuid REFERENCES public.email_job_sources(id) ON DELETE SET NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_integrations_provider_check
    CHECK (provider IN ('grok', 'claude', 'openai', 'gemini')),
  CONSTRAINT ai_integrations_plan_check
    CHECK (declared_plan_tier IN ('free', 'paid', 'unknown')),
  CONSTRAINT ai_integrations_mode_check
    CHECK (effective_mode IN ('guided', 'agent', 'email_rule', 'hybrid')),
  CONSTRAINT ai_integrations_status_check
    CHECK (status IN ('draft', 'connecting', 'active', 'degraded', 'disconnected')),
  CONSTRAINT ai_integrations_capabilities_object_check
    CHECK (jsonb_typeof(capabilities) = 'object'),
  CONSTRAINT ai_integrations_user_provider_key UNIQUE (user_id, provider)
);

CREATE INDEX ai_integrations_user_status_idx
  ON public.ai_integrations (user_id, status);

CREATE INDEX ai_integrations_email_job_source_idx
  ON public.ai_integrations (email_job_source_id)
  WHERE email_job_source_id IS NOT NULL;

CREATE TABLE public.ai_integration_setup_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ai_integration_id uuid NOT NULL REFERENCES public.ai_integrations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  setup_code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_setup_sessions_provider_check
    CHECK (provider IN ('grok', 'claude', 'openai', 'gemini')),
  CONSTRAINT ai_setup_sessions_hash_check
    CHECK (setup_code_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ai_setup_sessions_expiry_check
    CHECK (expires_at > created_at),
  CONSTRAINT ai_setup_sessions_hash_key UNIQUE (setup_code_hash)
);

CREATE INDEX ai_setup_sessions_integration_open_idx
  ON public.ai_integration_setup_sessions (ai_integration_id, expires_at DESC)
  WHERE consumed_at IS NULL;

CREATE INDEX ai_setup_sessions_user_idx
  ON public.ai_integration_setup_sessions (user_id);

CREATE TABLE public.automation_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  job_email_import_enabled boolean NOT NULL DEFAULT true,
  linkedin_export_import_enabled boolean NOT NULL DEFAULT true,
  linkedin_ready_detection_enabled boolean NOT NULL DEFAULT true,
  career_email_suggestions_enabled boolean NOT NULL DEFAULT false,
  career_email_suggestion_day smallint,
  calendar_ingest_enabled boolean NOT NULL DEFAULT false,
  calendar_followup_enabled boolean NOT NULL DEFAULT false,
  job_preference_automation_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_preferences_day_check
    CHECK (career_email_suggestion_day IS NULL OR career_email_suggestion_day BETWEEN 1 AND 28),
  CONSTRAINT automation_preferences_v1_locks_check
    CHECK (
      calendar_ingest_enabled = false
      AND calendar_followup_enabled = false
      AND job_preference_automation_enabled = false
    )
);

CREATE TABLE public.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ai_integration_id uuid REFERENCES public.ai_integrations(id) ON DELETE SET NULL,
  workflow_kind text NOT NULL,
  trigger_kind text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  items_seen integer NOT NULL DEFAULT 0,
  items_written integer NOT NULL DEFAULT 0,
  items_skipped integer NOT NULL DEFAULT 0,
  error_class text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_runs_workflow_check
    CHECK (workflow_kind IN ('job_import', 'career_log', 'linkedin_ready', 'cleanup')),
  CONSTRAINT automation_runs_trigger_check
    CHECK (trigger_kind IN ('user', 'schedule', 'event', 'retry')),
  CONSTRAINT automation_runs_status_check
    CHECK (status IN ('queued', 'running', 'awaiting_user', 'succeeded', 'partial', 'failed', 'dead_letter')),
  CONSTRAINT automation_runs_counts_check
    CHECK (items_seen >= 0 AND items_written >= 0 AND items_skipped >= 0),
  CONSTRAINT automation_runs_idempotency_key UNIQUE (user_id, workflow_kind, idempotency_key)
);

CREATE INDEX automation_runs_user_created_idx
  ON public.automation_runs (user_id, created_at DESC);

CREATE INDEX automation_runs_integration_idx
  ON public.automation_runs (ai_integration_id)
  WHERE ai_integration_id IS NOT NULL;

CREATE TABLE public.career_log_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ai_integration_id uuid REFERENCES public.ai_integrations(id) ON DELETE SET NULL,
  source_kind text NOT NULL,
  source_ref_hash text NOT NULL,
  suggested_type text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  occurred_on date,
  confidence numeric NOT NULL,
  status text NOT NULL DEFAULT 'proposed',
  provider text NOT NULL,
  model_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CONSTRAINT career_log_suggestions_source_check
    CHECK (source_kind IN ('email_in', 'email_out')),
  CONSTRAINT career_log_suggestions_type_check
    CHECK (suggested_type IN ('course', 'certification', 'project', 'result', 'role')),
  CONSTRAINT career_log_suggestions_confidence_check
    CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT career_log_suggestions_status_check
    CHECK (status IN ('proposed', 'approved', 'edited', 'rejected')),
  CONSTRAINT career_log_suggestions_provider_check
    CHECK (provider IN ('grok', 'claude', 'openai', 'gemini')),
  CONSTRAINT career_log_suggestions_source_key UNIQUE (user_id, source_kind, source_ref_hash, suggested_type)
);

CREATE INDEX career_log_suggestions_user_status_idx
  ON public.career_log_suggestions (user_id, status, created_at DESC);

CREATE INDEX career_log_suggestions_integration_idx
  ON public.career_log_suggestions (ai_integration_id)
  WHERE ai_integration_id IS NOT NULL;

CREATE TRIGGER set_ai_integrations_updated_at
  BEFORE UPDATE ON public.ai_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_automation_preferences_updated_at
  BEFORE UPDATE ON public.automation_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.ai_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_integration_setup_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.career_log_suggestions ENABLE ROW LEVEL SECURITY;

-- Eksplisitt tilbaketrekking foer begrensede grants, slik at generoese
-- default privileges i nye miljoeer ikke gir anon/authenticated for mye.
REVOKE ALL PRIVILEGES ON TABLE public.ai_integrations FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.ai_integration_setup_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.automation_preferences FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.automation_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.career_log_suggestions FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.ai_integrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_preferences TO authenticated;
GRANT SELECT ON public.automation_runs TO authenticated;
GRANT SELECT ON public.career_log_suggestions TO authenticated;
GRANT UPDATE (status, title, summary, occurred_on, reviewed_at)
  ON public.career_log_suggestions TO authenticated;

GRANT ALL ON public.ai_integrations TO service_role;
GRANT ALL ON public.ai_integration_setup_sessions TO service_role;
GRANT ALL ON public.automation_preferences TO service_role;
GRANT ALL ON public.automation_runs TO service_role;
GRANT ALL ON public.career_log_suggestions TO service_role;

CREATE POLICY "Users view own ai_integrations"
  ON public.ai_integrations FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users manage own automation_preferences"
  ON public.automation_preferences FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);
CREATE POLICY "Users insert own automation_preferences"
  ON public.automation_preferences FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "Users update own automation_preferences"
  ON public.automation_preferences FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "Users delete own automation_preferences"
  ON public.automation_preferences FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users view own automation_runs"
  ON public.automation_runs FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users view own career_log_suggestions"
  ON public.career_log_suggestions FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);
CREATE POLICY "Users review own career_log_suggestions"
  ON public.career_log_suggestions FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

COMMENT ON TABLE public.ai_integrations IS
  'Leverandørnøytral binding for Grok, Claude, ChatGPT/Codex og Gemini.';
COMMENT ON TABLE public.ai_integration_setup_sessions IS
  'Kortlivede bindingssesjoner. Bare hash lagres; klartekst returneres én gang.';
COMMENT ON TABLE public.automation_preferences IS
  'Eksplisitte brukervalg. Kalender og jobbpreferanseautomatisering er låst av i v1.';