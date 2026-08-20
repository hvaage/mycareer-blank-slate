-- =========================================================
-- LinkedIn-import fase 2, del 2: staginglag
-- =========================================================

CREATE TABLE public.linkedin_staging_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  staging_domain text NOT NULL
    CHECK (staging_domain IN ('profile','career','recommendation','network','job','learning','content')),
  record_kind text NOT NULL,
  purpose text NOT NULL
    CHECK (purpose IN ('profile','career','network','jobs','learning','content')),
  source_system text NOT NULL DEFAULT 'linkedin_export'
    CHECK (source_system = 'linkedin_export'),
  source_file text NOT NULL,
  source_locator_type text NOT NULL
    CHECK (source_locator_type IN ('csv_row','archive_file','html_section')),
  source_locator text NOT NULL,
  source_row_number integer,
  source_row_hash text,
  source_content_hash text,
  source_event_at timestamptz,
  source_recorded_at timestamptz,
  source_url text,
  source_classification text NOT NULL DEFAULT 'A' CHECK (source_classification IN ('A','B')),
  source_identity_hash text NOT NULL,
  first_linkedin_import_id uuid NOT NULL,
  last_linkedin_import_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linkedin_staging_records_id_user_key UNIQUE (id, user_id),
  CONSTRAINT linkedin_staging_records_id_domain_key UNIQUE (id, staging_domain),
  CONSTRAINT linkedin_staging_records_id_purpose_key UNIQUE (id, purpose),
  CONSTRAINT linkedin_staging_records_provenance_check CHECK (
    (source_locator_type = 'csv_row'
       AND source_row_number IS NOT NULL
       AND source_row_hash IS NOT NULL
       AND source_content_hash IS NULL)
    OR (source_locator_type IN ('archive_file','html_section')
       AND source_content_hash IS NOT NULL
       AND source_row_number IS NULL
       AND source_row_hash IS NULL)
  ),
  CONSTRAINT linkedin_staging_records_first_import_fk
    FOREIGN KEY (first_linkedin_import_id, user_id)
    REFERENCES public.linkedin_imports (id, user_id),
  CONSTRAINT linkedin_staging_records_last_import_fk
    FOREIGN KEY (last_linkedin_import_id, user_id)
    REFERENCES public.linkedin_imports (id, user_id)
);

CREATE UNIQUE INDEX linkedin_staging_records_identity_key
  ON public.linkedin_staging_records (user_id, source_file, source_identity_hash);

CREATE INDEX linkedin_staging_records_domain_idx
  ON public.linkedin_staging_records (user_id, staging_domain);

GRANT SELECT ON public.linkedin_staging_records TO authenticated;
GRANT ALL ON public.linkedin_staging_records TO service_role;
ALTER TABLE public.linkedin_staging_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "linkedin_staging_records_owner_select" ON public.linkedin_staging_records
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------
-- Domenetabeller (1:1 mot fellesraden)
-- ---------------------------------------------------------
CREATE TABLE public.linkedin_profile_staging (
  staging_record_id uuid PRIMARY KEY
    REFERENCES public.linkedin_staging_records (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  staging_domain text NOT NULL DEFAULT 'profile' CHECK (staging_domain = 'profile'),
  first_name text,
  last_name text,
  headline text,
  summary text,
  industry text,
  geo_location text,
  websites text[],
  CONSTRAINT linkedin_profile_staging_user_fk
    FOREIGN KEY (staging_record_id, user_id)
    REFERENCES public.linkedin_staging_records (id, user_id) ON DELETE CASCADE,
  CONSTRAINT linkedin_profile_staging_domain_fk
    FOREIGN KEY (staging_record_id, staging_domain)
    REFERENCES public.linkedin_staging_records (id, staging_domain) ON DELETE CASCADE
);

CREATE TABLE public.linkedin_career_staging (
  staging_record_id uuid PRIMARY KEY
    REFERENCES public.linkedin_staging_records (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  staging_domain text NOT NULL DEFAULT 'career' CHECK (staging_domain = 'career'),
  entry_kind text NOT NULL CHECK (entry_kind IN ('position','education','certification','skill','language','project','honor','volunteer')),
  organization_name text,
  title text,
  location text,
  description text,
  started_on text,
  finished_on text,
  date_precision text CHECK (date_precision IN ('year','month','day')),
  CONSTRAINT linkedin_career_staging_user_fk
    FOREIGN KEY (staging_record_id, user_id)
    REFERENCES public.linkedin_staging_records (id, user_id) ON DELETE CASCADE,
  CONSTRAINT linkedin_career_staging_domain_fk
    FOREIGN KEY (staging_record_id, staging_domain)
    REFERENCES public.linkedin_staging_records (id, staging_domain) ON DELETE CASCADE
);

CREATE TABLE public.linkedin_recommendation_staging (
  staging_record_id uuid PRIMARY KEY
    REFERENCES public.linkedin_staging_records (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  staging_domain text NOT NULL DEFAULT 'recommendation' CHECK (staging_domain = 'recommendation'),
  direction text NOT NULL CHECK (direction IN ('received','given')),
  counterpart_name text,
  counterpart_headline text,
  recommendation_text text,
  status text,
  CONSTRAINT linkedin_recommendation_staging_user_fk
    FOREIGN KEY (staging_record_id, user_id)
    REFERENCES public.linkedin_staging_records (id, user_id) ON DELETE CASCADE,
  CONSTRAINT linkedin_recommendation_staging_domain_fk
    FOREIGN KEY (staging_record_id, staging_domain)
    REFERENCES public.linkedin_staging_records (id, staging_domain) ON DELETE CASCADE
);

CREATE TABLE public.linkedin_network_staging (
  staging_record_id uuid PRIMARY KEY
    REFERENCES public.linkedin_staging_records (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  staging_domain text NOT NULL DEFAULT 'network' CHECK (staging_domain = 'network'),
  full_name text,
  company text,
  position text,
  connected_on text,
  profile_url text,
  CONSTRAINT linkedin_network_staging_user_fk
    FOREIGN KEY (staging_record_id, user_id)
    REFERENCES public.linkedin_staging_records (id, user_id) ON DELETE CASCADE,
  CONSTRAINT linkedin_network_staging_domain_fk
    FOREIGN KEY (staging_record_id, staging_domain)
    REFERENCES public.linkedin_staging_records (id, staging_domain) ON DELETE CASCADE
);

CREATE TABLE public.linkedin_job_staging (
  staging_record_id uuid PRIMARY KEY
    REFERENCES public.linkedin_staging_records (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  staging_domain text NOT NULL DEFAULT 'job' CHECK (staging_domain = 'job'),
  entry_kind text NOT NULL CHECK (entry_kind IN ('application','saved_job','job_alert','job_seeker_preference')),
  company_name text,
  job_title text,
  job_url text,
  application_state text,
  event_label text,
  CONSTRAINT linkedin_job_staging_user_fk
    FOREIGN KEY (staging_record_id, user_id)
    REFERENCES public.linkedin_staging_records (id, user_id) ON DELETE CASCADE,
  CONSTRAINT linkedin_job_staging_domain_fk
    FOREIGN KEY (staging_record_id, staging_domain)
    REFERENCES public.linkedin_staging_records (id, staging_domain) ON DELETE CASCADE
);

CREATE TABLE public.linkedin_learning_staging (
  staging_record_id uuid PRIMARY KEY
    REFERENCES public.linkedin_staging_records (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  staging_domain text NOT NULL DEFAULT 'learning' CHECK (staging_domain = 'learning'),
  course_title text,
  provider text,
  completed_on text,
  content_url text,
  progress_label text,
  CONSTRAINT linkedin_learning_staging_user_fk
    FOREIGN KEY (staging_record_id, user_id)
    REFERENCES public.linkedin_staging_records (id, user_id) ON DELETE CASCADE,
  CONSTRAINT linkedin_learning_staging_domain_fk
    FOREIGN KEY (staging_record_id, staging_domain)
    REFERENCES public.linkedin_staging_records (id, staging_domain) ON DELETE CASCADE
);

CREATE TABLE public.linkedin_content_staging (
  staging_record_id uuid PRIMARY KEY
    REFERENCES public.linkedin_staging_records (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  staging_domain text NOT NULL DEFAULT 'content' CHECK (staging_domain = 'content'),
  entry_kind text NOT NULL CHECK (entry_kind IN ('article','share','rich_media')),
  title text,
  content_url text,
  published_at text,
  media_kind text,
  CONSTRAINT linkedin_content_staging_user_fk
    FOREIGN KEY (staging_record_id, user_id)
    REFERENCES public.linkedin_staging_records (id, user_id) ON DELETE CASCADE,
  CONSTRAINT linkedin_content_staging_domain_fk
    FOREIGN KEY (staging_record_id, staging_domain)
    REFERENCES public.linkedin_staging_records (id, staging_domain) ON DELETE CASCADE
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'linkedin_profile_staging','linkedin_career_staging','linkedin_recommendation_staging',
    'linkedin_network_staging','linkedin_job_staging','linkedin_learning_staging',
    'linkedin_content_staging'
  ] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.uid() = user_id)',
      t || '_owner_select', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------
-- Kobling import <-> stagingrad, isolert per forsøk
-- ---------------------------------------------------------
CREATE TABLE public.linkedin_import_stage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  linkedin_import_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  user_id uuid NOT NULL,
  staging_record_id uuid NOT NULL,
  staging_domain text NOT NULL,
  purpose text NOT NULL,
  source_identity_hash text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linkedin_import_stage_records_unique
    UNIQUE (linkedin_import_id, attempt_id, staging_record_id),
  CONSTRAINT linkedin_import_stage_records_import_fk
    FOREIGN KEY (linkedin_import_id, user_id)
    REFERENCES public.linkedin_imports (id, user_id) ON DELETE CASCADE,
  CONSTRAINT linkedin_import_stage_records_record_user_fk
    FOREIGN KEY (staging_record_id, user_id)
    REFERENCES public.linkedin_staging_records (id, user_id) ON DELETE CASCADE,
  CONSTRAINT linkedin_import_stage_records_record_domain_fk
    FOREIGN KEY (staging_record_id, staging_domain)
    REFERENCES public.linkedin_staging_records (id, staging_domain) ON DELETE CASCADE,
  CONSTRAINT linkedin_import_stage_records_record_purpose_fk
    FOREIGN KEY (staging_record_id, purpose)
    REFERENCES public.linkedin_staging_records (id, purpose) ON DELETE CASCADE
);

CREATE INDEX linkedin_import_stage_records_record_idx
  ON public.linkedin_import_stage_records (staging_record_id);

GRANT SELECT ON public.linkedin_import_stage_records TO authenticated;
GRANT ALL ON public.linkedin_import_stage_records TO service_role;
ALTER TABLE public.linkedin_import_stage_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "linkedin_import_stage_records_owner_select" ON public.linkedin_import_stage_records
  FOR SELECT TO authenticated USING (auth.uid() = user_id);