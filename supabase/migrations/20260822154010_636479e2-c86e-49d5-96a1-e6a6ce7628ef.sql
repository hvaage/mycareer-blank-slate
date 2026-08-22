-- Fase 5D: aktivitetsforslag med KI (asynkron jobb)

ALTER TABLE public.next_steps
  ADD CONSTRAINT next_steps_id_user_id_key UNIQUE (id, user_id);

CREATE TABLE IF NOT EXISTS public.network_activity_suggestion_scope_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('overview','company','contact','opportunity')),
  scope_object_id uuid,
  scope_key text NOT NULL,
  generation_epoch integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nass_scope_object_shape CHECK (
    (scope = 'overview' AND scope_object_id IS NULL)
    OR (scope <> 'overview' AND scope_object_id IS NOT NULL)
  ),
  CONSTRAINT nass_scope_key_unique UNIQUE (user_id, scope_key)
);

GRANT SELECT ON public.network_activity_suggestion_scope_state TO authenticated;
GRANT ALL ON public.network_activity_suggestion_scope_state TO service_role;
ALTER TABLE public.network_activity_suggestion_scope_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scope_state_owner_read" ON public.network_activity_suggestion_scope_state
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.network_activity_suggestion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('overview','company','contact','opportunity')),
  scope_object_id uuid,
  scope_key text NOT NULL,
  generation_epoch integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  input_signature text NOT NULL,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  model_profile text NOT NULL,
  model_name text,
  prompt_version text NOT NULL,
  model_run_id uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  error_code text,
  suggestion_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT nasr_scope_object_shape CHECK (
    (scope = 'overview' AND scope_object_id IS NULL)
    OR (scope <> 'overview' AND scope_object_id IS NOT NULL)
  ),
  CONSTRAINT nasr_user_id_key UNIQUE (id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS nasr_active_signature_idx
  ON public.network_activity_suggestion_runs (user_id, input_signature)
  WHERE status IN ('queued','running','succeeded');
CREATE INDEX IF NOT EXISTS nasr_queue_idx
  ON public.network_activity_suggestion_runs (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS nasr_user_scope_idx
  ON public.network_activity_suggestion_runs (user_id, scope_key, created_at DESC);

GRANT SELECT ON public.network_activity_suggestion_runs TO authenticated;
GRANT ALL ON public.network_activity_suggestion_runs TO service_role;
ALTER TABLE public.network_activity_suggestion_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "suggestion_runs_owner_read" ON public.network_activity_suggestion_runs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.network_activity_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.network_activity_suggestion_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  source_class text NOT NULL DEFAULT 'ai_suggestion' CHECK (source_class = 'ai_suggestion'),
  activity_type text NOT NULL CHECK (activity_type IN
    ('oppfolging','moete','samtale','e_post','soknad','intervju','annet')),
  title text NOT NULL,
  rationale text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('low','medium','high')),
  suggested_timing jsonb NOT NULL DEFAULT '{}'::jsonb,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','accepted','dismissed','superseded')),
  decided_at timestamptz,
  created_activity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nas_created_activity_fk FOREIGN KEY (created_activity_id, user_id)
    REFERENCES public.next_steps (id, user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS nas_user_status_idx
  ON public.network_activity_suggestions (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS nas_run_idx ON public.network_activity_suggestions (run_id);

GRANT SELECT ON public.network_activity_suggestions TO authenticated;
GRANT ALL ON public.network_activity_suggestions TO service_role;
ALTER TABLE public.network_activity_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "suggestions_owner_read" ON public.network_activity_suggestions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);