
CREATE TABLE public.employer_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid UNIQUE NOT NULL,
  submitted_at timestamptz NOT NULL,
  schema_version text NOT NULL,

  language text NOT NULL,
  tier text NOT NULL,

  company_name text NOT NULL,
  company_domain text NOT NULL,
  branch_country text,
  parent_country text,
  analysis_date date,

  employee_count integer,
  employee_count_source text,
  employee_count_as_of date,
  revenue_bucket text,
  industry_nace text,

  overall_score numeric(3,2),
  scored_dimensions integer,
  total_dimensions integer,

  dimensions jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_count integer,
  search_count integer,
  scope_deviation boolean DEFAULT false,

  ingest_ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_employer_reports_domain ON public.employer_reports (company_domain);
CREATE INDEX idx_employer_reports_name_lower ON public.employer_reports (lower(company_name));
CREATE INDEX idx_employer_reports_submitted_at ON public.employer_reports (submitted_at DESC);
CREATE INDEX idx_employer_reports_domain_submitted ON public.employer_reports (company_domain, submitted_at DESC);
CREATE INDEX idx_employer_reports_branch_country ON public.employer_reports (branch_country);

ALTER TABLE public.employer_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read employer reports"
ON public.employer_reports
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "Service role can insert employer reports"
ON public.employer_reports
FOR INSERT
TO public
WITH CHECK (auth.role() = 'service_role');
