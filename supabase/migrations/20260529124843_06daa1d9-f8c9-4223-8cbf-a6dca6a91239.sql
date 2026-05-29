-- Remainder of migration 1 (job_applications, contacts, interviews, attachments)
CREATE TABLE public.job_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company TEXT NOT NULL,
  position TEXT NOT NULL,
  status public.application_status NOT NULL DEFAULT 'wishlist',
  applied_date DATE,
  location TEXT,
  remote_type TEXT,
  job_url TEXT,
  salary_min NUMERIC,
  salary_max NUMERIC,
  salary_currency TEXT DEFAULT 'NOK',
  notes TEXT,
  source TEXT,
  priority INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own applications" ON public.job_applications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own applications" ON public.job_applications FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own applications" ON public.job_applications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own applications" ON public.job_applications FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER job_applications_updated_at BEFORE UPDATE ON public.job_applications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_job_applications_user ON public.job_applications(user_id);
CREATE INDEX idx_job_applications_status ON public.job_applications(user_id, status);

CREATE TABLE public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id UUID REFERENCES public.job_applications(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  phone TEXT,
  linkedin_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own contacts" ON public.contacts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own contacts" ON public.contacts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own contacts" ON public.contacts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own contacts" ON public.contacts FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_contacts_application ON public.contacts(application_id);

CREATE TABLE public.interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  interview_type TEXT,
  scheduled_at TIMESTAMPTZ,
  duration_minutes INT,
  location TEXT,
  interviewer_names TEXT,
  notes TEXT,
  outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.interviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own interviews" ON public.interviews FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own interviews" ON public.interviews FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own interviews" ON public.interviews FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own interviews" ON public.interviews FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER interviews_updated_at BEFORE UPDATE ON public.interviews FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_interviews_application ON public.interviews(application_id);
CREATE INDEX idx_interviews_scheduled ON public.interviews(user_id, scheduled_at);

CREATE TABLE public.attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id UUID REFERENCES public.job_applications(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_type TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own attachments" ON public.attachments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own attachments" ON public.attachments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own attachments" ON public.attachments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own attachments" ON public.attachments FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_attachments_application ON public.attachments(application_id);

INSERT INTO storage.buckets (id, name, public) VALUES ('attachments', 'attachments', false) ON CONFLICT (id) DO NOTHING;
CREATE POLICY "Users can view own files" ON storage.objects FOR SELECT USING (bucket_id = 'attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can upload own files" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can update own files" ON storage.objects FOR UPDATE USING (bucket_id = 'attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete own files" ON storage.objects FOR DELETE USING (bucket_id = 'attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

-- ==== 20260506133021 ====
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ==== 20260506133046 ====
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;

-- ==== 20260506141900_create_documents_foundation ====
DO $$ BEGIN
  CREATE TYPE public.document_type AS ENUM ('cv','søknadsbrev','case_dokument','referanseliste','annet');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id uuid,
  title text NOT NULL,
  document_type public.document_type NOT NULL,
  content_text text,
  file_path text,
  file_name text,
  file_size_bytes bigint,
  is_base_version boolean DEFAULT false,
  tailored_for text,
  customization_notes text,
  version integer DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents(user_id);
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can insert own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can update own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can delete own documents" ON public.documents;
CREATE POLICY "Users can view own documents" ON public.documents FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own documents" ON public.documents FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own documents" ON public.documents FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own documents" ON public.documents FOR DELETE TO authenticated USING (auth.uid() = user_id);
DROP TRIGGER IF EXISTS min_dok_documents_updated_at ON public.documents;
CREATE TRIGGER min_dok_documents_updated_at BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ==== 20260506142005 ====
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS company_name text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS mime_type text;
DROP POLICY IF EXISTS users_upload_own_documents ON storage.objects;
CREATE POLICY users_upload_own_documents ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'job-documents' AND (auth.uid())::text = (storage.foldername(name))[1]);

-- ==== 20260506142459 ====
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS headline text,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS years_experience integer,
  ADD COLUMN IF NOT EXISTS current_role_title text,
  ADD COLUMN IF NOT EXISTS current_employer text,
  ADD COLUMN IF NOT EXISTS industries text[],
  ADD COLUMN IF NOT EXISTS skills text[],
  ADD COLUMN IF NOT EXISTS languages text[],
  ADD COLUMN IF NOT EXISTS target_roles text[],
  ADD COLUMN IF NOT EXISTS target_industries text[],
  ADD COLUMN IF NOT EXISTS target_seniority text,
  ADD COLUMN IF NOT EXISTS work_types text[],
  ADD COLUMN IF NOT EXISTS target_country text,
  ADD COLUMN IF NOT EXISTS target_region text,
  ADD COLUMN IF NOT EXISTS target_city text,
  ADD COLUMN IF NOT EXISTS willing_to_relocate boolean,
  ADD COLUMN IF NOT EXISTS salary_expectation_min integer,
  ADD COLUMN IF NOT EXISTS salary_expectation_max integer,
  ADD COLUMN IF NOT EXISTS salary_currency text DEFAULT 'NOK',
  ADD COLUMN IF NOT EXISTS available_from date,
  ADD COLUMN IF NOT EXISTS motivation text,
  ADD COLUMN IF NOT EXISTS strengths text,
  ADD COLUMN IF NOT EXISTS weaknesses text,
  ADD COLUMN IF NOT EXISTS achievements text,
  ADD COLUMN IF NOT EXISTS deal_breakers text,
  ADD COLUMN IF NOT EXISTS additional_notes text;

-- ==== 20260506163032 ====
CREATE TYPE public.email_provider AS ENUM ('google', 'microsoft');
CREATE TYPE public.email_connection_status AS ENUM ('active', 'expired', 'revoked', 'error');
CREATE TABLE public.email_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  provider public.email_provider NOT NULL,
  email_address TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes_granted TEXT[],
  status public.email_connection_status NOT NULL DEFAULT 'active',
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, email_address)
);
ALTER TABLE public.email_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own email connections" ON public.email_connections FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own email connections" ON public.email_connections FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own email connections" ON public.email_connections FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own email connections" ON public.email_connections FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER trg_email_connections_updated_at BEFORE UPDATE ON public.email_connections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_email_connections_user ON public.email_connections(user_id);

-- ==== 20260507080353 ====
ALTER TABLE public.email_connections ADD COLUMN IF NOT EXISTS last_synced_internal_date bigint;
DO $$ BEGIN
  CREATE TYPE public.job_lead_status AS ENUM ('ny', 'avvist', 'promotert', 'arkivert');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.job_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email_connection_id uuid REFERENCES public.email_connections(id) ON DELETE SET NULL,
  source_message_id text,
  source_email_from text,
  source_subject text,
  received_at timestamptz,
  posted_text text,
  title text,
  company text,
  location text,
  work_type text,
  salary_text text,
  job_url text,
  raw_snippet text,
  ai_score smallint,
  ai_reasoning text,
  ai_match_highlights text,
  ai_concerns text,
  status public.job_lead_status NOT NULL DEFAULT 'ny',
  promoted_application_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_leads_user_status ON public.job_leads(user_id, status);
CREATE INDEX IF NOT EXISTS idx_job_leads_user_score ON public.job_leads(user_id, ai_score DESC NULLS LAST);
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_leads_dedupe ON public.job_leads(user_id, COALESCE(job_url, ''), COALESCE(title, ''), COALESCE(company, ''));
ALTER TABLE public.job_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own job_leads" ON public.job_leads FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own job_leads" ON public.job_leads FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own job_leads" ON public.job_leads FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own job_leads" ON public.job_leads FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER trg_job_leads_updated_at BEFORE UPDATE ON public.job_leads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ==== 20260507113650 ====
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