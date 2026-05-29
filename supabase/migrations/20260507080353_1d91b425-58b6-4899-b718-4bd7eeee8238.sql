
-- Add sync cursor to email_connections
ALTER TABLE public.email_connections
  ADD COLUMN IF NOT EXISTS last_synced_internal_date bigint;

-- Lead status enum
DO $$ BEGIN
  CREATE TYPE public.job_lead_status AS ENUM ('ny', 'avvist', 'promotert', 'arkivert');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- job_leads table
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_leads_dedupe
  ON public.job_leads(user_id, COALESCE(job_url, ''), COALESCE(title, ''), COALESCE(company, ''));

ALTER TABLE public.job_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own job_leads"
  ON public.job_leads FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own job_leads"
  ON public.job_leads FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own job_leads"
  ON public.job_leads FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own job_leads"
  ON public.job_leads FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_job_leads_updated_at
  BEFORE UPDATE ON public.job_leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
