
-- Status enum for applications
CREATE TYPE public.application_status AS ENUM (
  'wishlist','applied','interviewing','offer','rejected','withdrawn','accepted'
);

-- Profiles table (auto-created on signup)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Trigger function for updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Job applications
CREATE TABLE public.job_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company TEXT NOT NULL,
  position TEXT NOT NULL,
  status public.application_status NOT NULL DEFAULT 'wishlist',
  applied_date DATE,
  location TEXT,
  remote_type TEXT, -- e.g. 'remote','hybrid','onsite'
  job_url TEXT,
  salary_min NUMERIC,
  salary_max NUMERIC,
  salary_currency TEXT DEFAULT 'NOK',
  notes TEXT,
  source TEXT, -- e.g. 'LinkedIn','Finn.no'
  priority INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own applications" ON public.job_applications
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own applications" ON public.job_applications
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own applications" ON public.job_applications
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own applications" ON public.job_applications
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER job_applications_updated_at BEFORE UPDATE ON public.job_applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_job_applications_user ON public.job_applications(user_id);
CREATE INDEX idx_job_applications_status ON public.job_applications(user_id, status);

-- Contacts (people connected to an application)
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

CREATE POLICY "Users can view own contacts" ON public.contacts
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own contacts" ON public.contacts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own contacts" ON public.contacts
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own contacts" ON public.contacts
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_contacts_application ON public.contacts(application_id);

-- Interviews
CREATE TABLE public.interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  interview_type TEXT, -- 'phone','technical','onsite','final'
  scheduled_at TIMESTAMPTZ,
  duration_minutes INT,
  location TEXT, -- physical address or video link
  interviewer_names TEXT,
  notes TEXT,
  outcome TEXT, -- 'pending','passed','failed'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.interviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own interviews" ON public.interviews
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own interviews" ON public.interviews
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own interviews" ON public.interviews
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own interviews" ON public.interviews
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER interviews_updated_at BEFORE UPDATE ON public.interviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_interviews_application ON public.interviews(application_id);
CREATE INDEX idx_interviews_scheduled ON public.interviews(user_id, scheduled_at);

-- Attachments (files like CVs, cover letters)
CREATE TABLE public.attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id UUID REFERENCES public.job_applications(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL, -- path in storage bucket
  file_type TEXT, -- 'cv','cover_letter','other'
  mime_type TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own attachments" ON public.attachments
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own attachments" ON public.attachments
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own attachments" ON public.attachments
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own attachments" ON public.attachments
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_attachments_application ON public.attachments(application_id);

-- Storage bucket for attachments
INSERT INTO storage.buckets (id, name, public) VALUES ('attachments', 'attachments', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can view own files" ON storage.objects
  FOR SELECT USING (bucket_id = 'attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can upload own files" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can update own files" ON storage.objects
  FOR UPDATE USING (bucket_id = 'attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete own files" ON storage.objects
  FOR DELETE USING (bucket_id = 'attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
