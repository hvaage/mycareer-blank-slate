CREATE TABLE public.application_stages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  stage_type text NOT NULL CHECK (stage_type IN ('screening','intervju_1','intervju_2','intervju_3','intervju_4','case_study','candidate_profiling')),
  stage_status text NOT NULL DEFAULT 'planlagt' CHECK (stage_status IN ('planlagt','gjennomført','avbrutt','avventet')),
  stage_date date,
  stage_order integer NOT NULL DEFAULT 1,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX application_stages_application_id_idx ON public.application_stages(application_id, stage_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.application_stages TO authenticated;
GRANT ALL ON public.application_stages TO service_role;

ALTER TABLE public.application_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view stages on own applications"
ON public.application_stages FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.applications a WHERE a.id = application_id AND a.user_id = auth.uid()));

CREATE POLICY "Users can insert stages on own applications"
ON public.application_stages FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.applications a WHERE a.id = application_id AND a.user_id = auth.uid()));

CREATE POLICY "Users can update stages on own applications"
ON public.application_stages FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.applications a WHERE a.id = application_id AND a.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.applications a WHERE a.id = application_id AND a.user_id = auth.uid()));

CREATE POLICY "Users can delete stages on own applications"
ON public.application_stages FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.applications a WHERE a.id = application_id AND a.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_application_stages_updated_at
BEFORE UPDATE ON public.application_stages
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();