-- ============ Enumtyper ============
DO $$ BEGIN
  CREATE TYPE public.employer_review_target_kind AS ENUM ('juridisk_enhet','arbeidsgivervirksomhet','konsern');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.employer_experience_basis AS ENUM
    ('current_employee','former_employee','contractor','applicant','interviewed','customer','partner','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.employer_experience_cohort AS ENUM
    ('employee_experience','candidate_experience','external_relationship','not_eligible');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.employer_review_numeric_status AS ENUM
    ('draft','eligible_for_aggregate','withdrawn','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.employer_review_text_status AS ENUM
    ('draft','submitted','ai_checked','needs_manual_review','approved','needs_revision','rejected','withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.employer_review_dimension AS ENUM
    ('culture','leadership','work_environment','career_development',
     'financial_stability','mission','talent_attraction_retention','diversity_inclusion');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ Vurderingsobjekter ============
CREATE TABLE IF NOT EXISTS public.employer_review_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_kind public.employer_review_target_kind NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  organisasjonsnummer text,
  underenhet_identity text,
  group_identity text,
  parent_target_id uuid REFERENCES public.employer_review_targets(id) ON DELETE RESTRICT,
  display_name text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employer_review_targets_kind_identity_check CHECK (
    (target_kind = 'juridisk_enhet' AND company_id IS NOT NULL AND organisasjonsnummer ~ '^[0-9]{9}$'
       AND underenhet_identity IS NULL AND group_identity IS NULL)
    OR (target_kind = 'arbeidsgivervirksomhet' AND underenhet_identity IS NOT NULL AND parent_target_id IS NOT NULL
       AND group_identity IS NULL)
    OR (target_kind = 'konsern' AND group_identity IS NOT NULL
       AND underenhet_identity IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS employer_review_targets_active_legal_uq
  ON public.employer_review_targets (company_id)
  WHERE superseded_at IS NULL AND target_kind = 'juridisk_enhet';
CREATE UNIQUE INDEX IF NOT EXISTS employer_review_targets_active_unit_uq
  ON public.employer_review_targets (underenhet_identity)
  WHERE superseded_at IS NULL AND target_kind = 'arbeidsgivervirksomhet';
CREATE UNIQUE INDEX IF NOT EXISTS employer_review_targets_active_group_uq
  ON public.employer_review_targets (group_identity)
  WHERE superseded_at IS NULL AND target_kind = 'konsern';

GRANT SELECT ON public.employer_review_targets TO authenticated;
GRANT ALL ON public.employer_review_targets TO service_role;
ALTER TABLE public.employer_review_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Innloggede kan lese verifiserte vurderingsobjekter"
  ON public.employer_review_targets FOR SELECT TO authenticated
  USING (superseded_at IS NULL);

-- ============ Gjestekontroll ============
CREATE TABLE IF NOT EXISTS public.employer_review_guest_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hmac text NOT NULL,
  ip_hmac text,
  otp_hash text,
  otp_expires_at timestamptz,
  verified_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  retention_until timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS employer_review_guest_controls_email_uq
  ON public.employer_review_guest_controls (email_hmac);
GRANT ALL ON public.employer_review_guest_controls TO service_role;
ALTER TABLE public.employer_review_guest_controls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Ingen direkte tilgang til gjestekontroll"
  ON public.employer_review_guest_controls FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ============ Vurderinger ============
CREATE TABLE IF NOT EXISTS public.employer_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_target_id uuid NOT NULL REFERENCES public.employer_review_targets(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_control_id uuid REFERENCES public.employer_review_guest_controls(id) ON DELETE CASCADE,
  experience_basis public.employer_experience_basis NOT NULL,
  experience_cohort public.employer_experience_cohort NOT NULL,
  numeric_contribution_status public.employer_review_numeric_status NOT NULL DEFAULT 'draft',
  provenance text NOT NULL DEFAULT 'employer_reviews_v1',
  is_active boolean NOT NULL DEFAULT true,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employer_reviews_single_author_check
    CHECK ((user_id IS NOT NULL) <> (guest_control_id IS NOT NULL)),
  CONSTRAINT employer_reviews_not_eligible_check
    CHECK (experience_cohort <> 'not_eligible' OR numeric_contribution_status <> 'eligible_for_aggregate')
);

CREATE UNIQUE INDEX IF NOT EXISTS employer_reviews_active_user_uq
  ON public.employer_reviews (user_id, review_target_id, experience_basis)
  WHERE is_active AND user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS employer_reviews_active_guest_uq
  ON public.employer_reviews (guest_control_id, review_target_id, experience_basis)
  WHERE is_active AND guest_control_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS employer_reviews_target_cohort_idx
  ON public.employer_reviews (review_target_id, experience_cohort)
  WHERE is_active AND numeric_contribution_status = 'eligible_for_aggregate';

GRANT SELECT ON public.employer_reviews TO authenticated;
GRANT ALL ON public.employer_reviews TO service_role;
ALTER TABLE public.employer_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Brukere kan lese egne vurderinger"
  ON public.employer_reviews FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ============ Dimensjonssvar ============
CREATE TABLE IF NOT EXISTS public.employer_review_dimension_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.employer_reviews(id) ON DELETE CASCADE,
  dimension public.employer_review_dimension NOT NULL,
  score smallint,
  insufficient_basis boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employer_review_dimension_scores_exactly_one_check CHECK (
    (score IS NOT NULL AND score BETWEEN 1 AND 5 AND insufficient_basis = false)
    OR (score IS NULL AND insufficient_basis = true)
  ),
  CONSTRAINT employer_review_dimension_scores_uq UNIQUE (review_id, dimension)
);
GRANT SELECT ON public.employer_review_dimension_scores TO authenticated;
GRANT ALL ON public.employer_review_dimension_scores TO service_role;
ALTER TABLE public.employer_review_dimension_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Brukere kan lese egne dimensjonssvar"
  ON public.employer_review_dimension_scores FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employer_reviews r
                 WHERE r.id = review_id AND r.user_id = auth.uid()));

-- ============ Fritekst ============
CREATE TABLE IF NOT EXISTS public.employer_review_texts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.employer_reviews(id) ON DELETE CASCADE,
  body text NOT NULL,
  anonymized_excerpt text,
  publication_status public.employer_review_text_status NOT NULL DEFAULT 'draft',
  approved_at timestamptz,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employer_review_texts_uq UNIQUE (review_id)
);
GRANT SELECT ON public.employer_review_texts TO authenticated;
GRANT ALL ON public.employer_review_texts TO service_role;
ALTER TABLE public.employer_review_texts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Brukere kan lese egen fritekst"
  ON public.employer_review_texts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employer_reviews r
                 WHERE r.id = review_id AND r.user_id = auth.uid()));

-- ============ Moderering ============
CREATE TABLE IF NOT EXISTS public.employer_review_moderation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.employer_reviews(id) ON DELETE CASCADE,
  ai_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_model text,
  rule_version text,
  ai_checked_at timestamptz,
  manual_decision text,
  manual_decided_by uuid,
  manual_decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employer_review_moderation_decision_check
    CHECK (manual_decision IS NULL OR manual_decision IN ('approved','needs_revision','rejected'))
);
GRANT ALL ON public.employer_review_moderation TO service_role;
ALTER TABLE public.employer_review_moderation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Kun administratorer kan lese moderering"
  ON public.employer_review_moderation FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============ Revisjonshistorikk ============
CREATE TABLE IF NOT EXISTS public.employer_review_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.employer_reviews(id) ON DELETE CASCADE,
  revision_kind text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.employer_review_revisions TO service_role;
ALTER TABLE public.employer_review_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Kun administratorer kan lese revisjoner"
  ON public.employer_review_revisions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============ Aggregater ============
CREATE TABLE IF NOT EXISTS public.employer_review_aggregates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_target_id uuid NOT NULL REFERENCES public.employer_review_targets(id) ON DELETE CASCADE,
  experience_cohort public.employer_experience_cohort NOT NULL,
  dimension public.employer_review_dimension NOT NULL,
  average_score numeric(4,2),
  contributor_count integer NOT NULL DEFAULT 0,
  insufficient_basis_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employer_review_aggregates_uq UNIQUE (review_target_id, experience_cohort, dimension)
);
GRANT ALL ON public.employer_review_aggregates TO service_role;
ALTER TABLE public.employer_review_aggregates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Ingen direkte tabellesing av aggregater"
  ON public.employer_review_aggregates FOR ALL TO authenticated
  USING (false) WITH CHECK (false);