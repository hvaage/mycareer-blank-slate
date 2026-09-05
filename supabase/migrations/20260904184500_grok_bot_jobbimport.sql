-- Grok Bot jobbimport: status på videresendingskilde + kortlivede oppsettkoder.
-- Innkommende e-post går fortsatt via POST /api/public/inbound/job-email.

ALTER TABLE public.email_job_sources
  ADD COLUMN IF NOT EXISTS grok_setup_status text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

ALTER TABLE public.email_job_sources
  DROP CONSTRAINT IF EXISTS email_job_sources_grok_setup_status_check;
ALTER TABLE public.email_job_sources
  ADD CONSTRAINT email_job_sources_grok_setup_status_check
  CHECK (
    grok_setup_status IS NULL
    OR grok_setup_status IN ('pending_alias', 'pending_verify', 'active')
  );

COMMENT ON COLUMN public.email_job_sources.grok_setup_status IS
  'pending_alias | pending_verify | active — oppsettsstatus for Grok Bot-videresending';

-- Én videresendingsadresse per bruker (Gmail-mailbox-rader er upåvirket).
CREATE UNIQUE INDEX IF NOT EXISTS email_job_sources_one_forwarding_per_user_idx
  ON public.email_job_sources (user_id)
  WHERE intake_mode = 'forwarding';

CREATE TABLE IF NOT EXISTS public.grok_bot_setup_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  setup_code text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grok_bot_setup_sessions_setup_code_key UNIQUE (setup_code),
  CONSTRAINT grok_bot_setup_sessions_setup_code_len
    CHECK (char_length(setup_code) BETWEEN 6 AND 12)
);

CREATE INDEX IF NOT EXISTS grok_bot_setup_sessions_user_id_idx
  ON public.grok_bot_setup_sessions (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.grok_bot_setup_sessions TO authenticated;
GRANT ALL ON public.grok_bot_setup_sessions TO service_role;
ALTER TABLE public.grok_bot_setup_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own grok_bot_setup_sessions" ON public.grok_bot_setup_sessions;
CREATE POLICY "Users view own grok_bot_setup_sessions" ON public.grok_bot_setup_sessions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own grok_bot_setup_sessions" ON public.grok_bot_setup_sessions;
CREATE POLICY "Users insert own grok_bot_setup_sessions" ON public.grok_bot_setup_sessions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own grok_bot_setup_sessions" ON public.grok_bot_setup_sessions;
CREATE POLICY "Users update own grok_bot_setup_sessions" ON public.grok_bot_setup_sessions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own grok_bot_setup_sessions" ON public.grok_bot_setup_sessions;
CREATE POLICY "Users delete own grok_bot_setup_sessions" ON public.grok_bot_setup_sessions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
