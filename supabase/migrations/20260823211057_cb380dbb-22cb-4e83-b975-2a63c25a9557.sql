-- Trinn A: additive columns on job_leads
ALTER TABLE public.job_leads
  ADD COLUMN IF NOT EXISTS qualification_status text,
  ADD COLUMN IF NOT EXISTS qualification_score smallint,
  ADD COLUMN IF NOT EXISTS qualification_reason text,
  ADD COLUMN IF NOT EXISTS application_due timestamptz,
  ADD COLUMN IF NOT EXISTS raw_payload jsonb,
  ADD COLUMN IF NOT EXISTS parse_confidence numeric,
  ADD COLUMN IF NOT EXISTS reject_reason text;

ALTER TABLE public.job_leads
  DROP CONSTRAINT IF EXISTS job_leads_qualification_status_check;
ALTER TABLE public.job_leads
  ADD CONSTRAINT job_leads_qualification_status_check
  CHECK (qualification_status IS NULL OR qualification_status IN ('pending','qualified','rejected','needs_review'));

ALTER TABLE public.job_leads
  DROP CONSTRAINT IF EXISTS job_leads_parse_confidence_check;
ALTER TABLE public.job_leads
  ADD CONSTRAINT job_leads_parse_confidence_check
  CHECK (parse_confidence IS NULL OR (parse_confidence >= 0 AND parse_confidence <= 1));

CREATE INDEX IF NOT EXISTS job_leads_qualification_status_idx
  ON public.job_leads (user_id, qualification_status);
CREATE INDEX IF NOT EXISTS job_leads_application_due_idx
  ON public.job_leads (user_id, application_due) WHERE application_due IS NOT NULL;

-- email_job_sources: configured inbound sources per user
CREATE TABLE IF NOT EXISTS public.email_job_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_connection_id uuid REFERENCES public.email_connections(id) ON DELETE CASCADE,
  source_system text NOT NULL,
  intake_mode text NOT NULL DEFAULT 'mailbox',
  label text,
  filter_query text,
  sender_pattern text,
  inbound_alias_token text UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  last_synced_internal_date text,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_job_sources_source_system_check
    CHECK (source_system IN ('finn','linkedin','other')),
  CONSTRAINT email_job_sources_intake_mode_check
    CHECK (intake_mode IN ('mailbox','forwarding')),
  CONSTRAINT email_job_sources_mailbox_needs_connection
    CHECK (intake_mode <> 'mailbox' OR email_connection_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS email_job_sources_unique_mailbox_idx
  ON public.email_job_sources (user_id, email_connection_id, source_system)
  WHERE email_connection_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_job_sources TO authenticated;
GRANT ALL ON public.email_job_sources TO service_role;
ALTER TABLE public.email_job_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own email_job_sources" ON public.email_job_sources;
CREATE POLICY "Users view own email_job_sources" ON public.email_job_sources
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users insert own email_job_sources" ON public.email_job_sources;
CREATE POLICY "Users insert own email_job_sources" ON public.email_job_sources
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users update own email_job_sources" ON public.email_job_sources;
CREATE POLICY "Users update own email_job_sources" ON public.email_job_sources
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users delete own email_job_sources" ON public.email_job_sources;
CREATE POLICY "Users delete own email_job_sources" ON public.email_job_sources
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS set_email_job_sources_updated_at ON public.email_job_sources;
CREATE TRIGGER set_email_job_sources_updated_at
  BEFORE UPDATE ON public.email_job_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- imported_job_emails: raw email payloads with their own retention
CREATE TABLE IF NOT EXISTS public.imported_job_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_connection_id uuid REFERENCES public.email_connections(id) ON DELETE SET NULL,
  email_job_source_id uuid REFERENCES public.email_job_sources(id) ON DELETE SET NULL,
  source_system text NOT NULL,
  intake_mode text NOT NULL DEFAULT 'mailbox',
  provider_message_id text NOT NULL,
  provider_internal_date text,
  from_address text,
  to_address text,
  subject text,
  received_at timestamptz,
  raw_text text,
  raw_html text,
  size_bytes integer,
  parse_status text NOT NULL DEFAULT 'pending',
  parse_confidence numeric,
  reject_reason text,
  parsed_at timestamptz,
  lead_count integer NOT NULL DEFAULT 0,
  retain_until timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT imported_job_emails_source_system_check
    CHECK (source_system IN ('finn','linkedin','other')),
  CONSTRAINT imported_job_emails_intake_mode_check
    CHECK (intake_mode IN ('mailbox','forwarding')),
  CONSTRAINT imported_job_emails_parse_status_check
    CHECK (parse_status IN ('pending','parsed','partial','rejected','failed')),
  CONSTRAINT imported_job_emails_parse_confidence_check
    CHECK (parse_confidence IS NULL OR (parse_confidence >= 0 AND parse_confidence <= 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS imported_job_emails_message_idx
  ON public.imported_job_emails (user_id, source_system, provider_message_id);
CREATE INDEX IF NOT EXISTS imported_job_emails_parse_status_idx
  ON public.imported_job_emails (user_id, parse_status);
CREATE INDEX IF NOT EXISTS imported_job_emails_retain_until_idx
  ON public.imported_job_emails (retain_until);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.imported_job_emails TO authenticated;
GRANT ALL ON public.imported_job_emails TO service_role;
ALTER TABLE public.imported_job_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own imported_job_emails" ON public.imported_job_emails;
CREATE POLICY "Users view own imported_job_emails" ON public.imported_job_emails
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users insert own imported_job_emails" ON public.imported_job_emails;
CREATE POLICY "Users insert own imported_job_emails" ON public.imported_job_emails
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users update own imported_job_emails" ON public.imported_job_emails;
CREATE POLICY "Users update own imported_job_emails" ON public.imported_job_emails
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users delete own imported_job_emails" ON public.imported_job_emails;
CREATE POLICY "Users delete own imported_job_emails" ON public.imported_job_emails
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS set_imported_job_emails_updated_at ON public.imported_job_emails;
CREATE TRIGGER set_imported_job_emails_updated_at
  BEFORE UPDATE ON public.imported_job_emails
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- link a lead back to the raw email it came from (composite FK keeps it user-scoped)
ALTER TABLE public.imported_job_emails
  DROP CONSTRAINT IF EXISTS imported_job_emails_user_id_id_key;
ALTER TABLE public.imported_job_emails
  ADD CONSTRAINT imported_job_emails_user_id_id_key UNIQUE (user_id, id);

ALTER TABLE public.job_leads
  ADD COLUMN IF NOT EXISTS imported_job_email_id uuid;
ALTER TABLE public.job_leads
  DROP CONSTRAINT IF EXISTS job_leads_imported_job_email_fk;
ALTER TABLE public.job_leads
  ADD CONSTRAINT job_leads_imported_job_email_fk
  FOREIGN KEY (user_id, imported_job_email_id)
  REFERENCES public.imported_job_emails (user_id, id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS job_leads_imported_job_email_idx
  ON public.job_leads (imported_job_email_id) WHERE imported_job_email_id IS NOT NULL;