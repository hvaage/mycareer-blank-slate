-- Pre: ensure get_user_employers exists (referenced by Module 4.5 policies)
CREATE OR REPLACE FUNCTION public.get_user_employers(p_user_id uuid)
RETURNS TABLE (company_id uuid, source text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT c.id, 'application'::text FROM public.applications a
    JOIN public.companies c ON c.id = a.company_id
    WHERE a.user_id = p_user_id AND a.company_id IS NOT NULL
  UNION
  SELECT DISTINCT c.id, 'name_match'::text FROM public.applications a
    JOIN public.companies c ON lower(c.name) = lower(a.company_name)
    WHERE a.user_id = p_user_id AND a.company_id IS NULL
  UNION
  SELECT DISTINCT ucr.company_id, 'rating'::text FROM public.user_company_ratings ucr
    WHERE ucr.user_id = p_user_id AND ucr.company_id IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.get_user_employers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_employers(uuid) TO authenticated;

-- 20260518120000_employer_analysis_jobs_unique_include_rate_limited
DROP INDEX IF EXISTS public.employer_analysis_jobs_one_active_per_user_company;
CREATE UNIQUE INDEX employer_analysis_jobs_one_active_per_user_company
  ON public.employer_analysis_jobs (user_id, company_id)
  WHERE status IN ('queued', 'processing', 'rate_limited');

-- 20260519100000_user_career_profiles
CREATE TABLE public.user_career_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  career_stage text,
  leadership_level text,
  primary_industry text,
  years_experience integer CHECK (years_experience IS NULL OR years_experience >= 0),
  desired_role_types text[],
  desired_industries text[],
  preferred_company_sizes text[],
  preferred_work_styles text[],
  preferred_locations text[],
  salary_expectation_min numeric,
  salary_expectation_max numeric,
  remote_preference text,
  travel_preference text,
  stability_vs_growth integer CHECK (stability_vs_growth IS NULL OR (stability_vs_growth BETWEEN 1 AND 6)),
  mission_importance integer CHECK (mission_importance IS NULL OR (mission_importance BETWEEN 1 AND 6)),
  innovation_importance integer CHECK (innovation_importance IS NULL OR (innovation_importance BETWEEN 1 AND 6)),
  sustainability_importance integer CHECK (sustainability_importance IS NULL OR (sustainability_importance BETWEEN 1 AND 6)),
  work_life_balance_importance integer CHECK (work_life_balance_importance IS NULL OR (work_life_balance_importance BETWEEN 1 AND 6)),
  compensation_importance integer CHECK (compensation_importance IS NULL OR (compensation_importance BETWEEN 1 AND 6)),
  leadership_ambition integer CHECK (leadership_ambition IS NULL OR (leadership_ambition BETWEEN 1 AND 6)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_career_profiles_user_id ON public.user_career_profiles (user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_career_profiles TO authenticated;
GRANT ALL ON public.user_career_profiles TO service_role;
ALTER TABLE public.user_career_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_career_profiles_select_own ON public.user_career_profiles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY user_career_profiles_insert_own ON public.user_career_profiles FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY user_career_profiles_update_own ON public.user_career_profiles FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY user_career_profiles_delete_own ON public.user_career_profiles FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE TRIGGER set_user_career_profiles_updated_at BEFORE UPDATE ON public.user_career_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260519120000_user_career_profiles_extra_columns
ALTER TABLE public.user_career_profiles
  ADD COLUMN IF NOT EXISTS dimension_weights jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS profile_intent text,
  ADD COLUMN IF NOT EXISTS completeness_score numeric,
  ADD COLUMN IF NOT EXISTS last_ai_profile_review_at timestamptz;

-- 20260520100000_user_preference_and_evidence_atoms
CREATE TABLE public.user_preference_atoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  career_profile_id uuid REFERENCES public.user_career_profiles (id) ON DELETE CASCADE,
  dimension text NOT NULL,
  label text NOT NULL,
  value text,
  importance_score integer CHECK (importance_score IS NULL OR (importance_score BETWEEN 1 AND 6)),
  confidence_score numeric,
  source text NOT NULL DEFAULT 'manual',
  source_field text,
  reasoning text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_preference_atoms_user_id ON public.user_preference_atoms (user_id);
CREATE INDEX idx_user_preference_atoms_user_dimension ON public.user_preference_atoms (user_id, dimension);
CREATE INDEX idx_user_preference_atoms_user_active ON public.user_preference_atoms (user_id, is_active);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_preference_atoms TO authenticated;
GRANT ALL ON public.user_preference_atoms TO service_role;

CREATE TABLE public.user_evidence_atoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  category text NOT NULL,
  label text NOT NULL,
  description text,
  evidence_type text,
  source text NOT NULL DEFAULT 'manual',
  source_document_id uuid REFERENCES public.documents (id) ON DELETE SET NULL,
  source_profile_field text,
  source_url text,
  strength_score integer CHECK (strength_score IS NULL OR (strength_score BETWEEN 1 AND 6)),
  confidence_score numeric,
  reasoning text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_evidence_atoms_user_id ON public.user_evidence_atoms (user_id);
CREATE INDEX idx_user_evidence_atoms_user_category ON public.user_evidence_atoms (user_id, category);
CREATE INDEX idx_user_evidence_atoms_user_active ON public.user_evidence_atoms (user_id, is_active);
CREATE INDEX idx_user_evidence_atoms_source_document ON public.user_evidence_atoms (source_document_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_evidence_atoms TO authenticated;
GRANT ALL ON public.user_evidence_atoms TO service_role;

ALTER TABLE public.user_preference_atoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_evidence_atoms ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_preference_atoms_select_own ON public.user_preference_atoms FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY user_preference_atoms_insert_own ON public.user_preference_atoms FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY user_preference_atoms_update_own ON public.user_preference_atoms FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY user_preference_atoms_delete_own ON public.user_preference_atoms FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY user_evidence_atoms_select_own ON public.user_evidence_atoms FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY user_evidence_atoms_insert_own ON public.user_evidence_atoms FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY user_evidence_atoms_update_own ON public.user_evidence_atoms FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY user_evidence_atoms_delete_own ON public.user_evidence_atoms FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE TRIGGER set_user_preference_atoms_updated_at BEFORE UPDATE ON public.user_preference_atoms FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER set_user_evidence_atoms_updated_at BEFORE UPDATE ON public.user_evidence_atoms FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260521100000_match_assessments_and_positioning
CREATE TABLE public.match_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies (id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.canonical_opportunities (id) ON DELETE CASCADE,
  listing_id uuid REFERENCES public.job_listings (id) ON DELETE SET NULL,
  assessment_type text NOT NULL,
  overall_match_score numeric,
  evidence_strength_score numeric,
  positioning_score numeric,
  apply_recommendation_score numeric,
  match_band text,
  summary text,
  reasoning jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendation_summary text,
  status text NOT NULL DEFAULT 'draft',
  source text NOT NULL DEFAULT 'system',
  generated_by text,
  generated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_match_assessments_user_id ON public.match_assessments (user_id);
CREATE INDEX idx_match_assessments_company_id ON public.match_assessments (company_id);
CREATE INDEX idx_match_assessments_opportunity_id ON public.match_assessments (opportunity_id);
CREATE INDEX idx_match_assessments_status ON public.match_assessments (status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_assessments TO authenticated;
GRANT ALL ON public.match_assessments TO service_role;

CREATE TABLE public.match_dimension_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.match_assessments (id) ON DELETE CASCADE,
  dimension text NOT NULL,
  preference_alignment_score numeric,
  evidence_strength_score numeric,
  market_alignment_score numeric,
  overall_dimension_score numeric,
  score_band text,
  matched_preference_atoms jsonb NOT NULL DEFAULT '[]'::jsonb,
  matched_evidence_atoms jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_evidence_atoms jsonb NOT NULL DEFAULT '[]'::jsonb,
  inferred_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  reasoning text,
  recommendation text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_match_dimension_assessments_assessment_id ON public.match_dimension_assessments (assessment_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_dimension_assessments TO authenticated;
GRANT ALL ON public.match_dimension_assessments TO service_role;

CREATE TABLE public.positioning_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.match_assessments (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  category text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  priority_score numeric,
  impact_score numeric,
  effort_score numeric,
  status text NOT NULL DEFAULT 'open',
  generated_by text,
  source_dimension text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_positioning_recommendations_assessment_id ON public.positioning_recommendations (assessment_id);
CREATE INDEX idx_positioning_recommendations_user_id ON public.positioning_recommendations (user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.positioning_recommendations TO authenticated;
GRANT ALL ON public.positioning_recommendations TO service_role;

ALTER TABLE public.match_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_dimension_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.positioning_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY match_assessments_select_own ON public.match_assessments FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY match_assessments_insert_own ON public.match_assessments FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY match_assessments_update_own ON public.match_assessments FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY match_assessments_delete_own ON public.match_assessments FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY mda_select_own ON public.match_dimension_assessments FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.match_assessments ma WHERE ma.id = assessment_id AND ma.user_id = auth.uid()));
CREATE POLICY mda_insert_own ON public.match_dimension_assessments FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.match_assessments ma WHERE ma.id = assessment_id AND ma.user_id = auth.uid()));
CREATE POLICY mda_update_own ON public.match_dimension_assessments FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.match_assessments ma WHERE ma.id = assessment_id AND ma.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.match_assessments ma WHERE ma.id = assessment_id AND ma.user_id = auth.uid()));
CREATE POLICY mda_delete_own ON public.match_dimension_assessments FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.match_assessments ma WHERE ma.id = assessment_id AND ma.user_id = auth.uid()));
CREATE POLICY pr_select_own ON public.positioning_recommendations FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY pr_insert_own ON public.positioning_recommendations FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY pr_update_own ON public.positioning_recommendations FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY pr_delete_own ON public.positioning_recommendations FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE TRIGGER set_match_assessments_updated_at BEFORE UPDATE ON public.match_assessments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER set_match_dimension_assessments_updated_at BEFORE UPDATE ON public.match_dimension_assessments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER set_positioning_recommendations_updated_at BEFORE UPDATE ON public.positioning_recommendations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260522120000_user_atoms_source_hash_refresh
ALTER TABLE public.user_preference_atoms
  ADD COLUMN IF NOT EXISTS source_hash text,
  ADD COLUMN IF NOT EXISTS refreshed_at timestamptz,
  ADD COLUMN IF NOT EXISTS stale_at timestamptz;
ALTER TABLE public.user_evidence_atoms
  ADD COLUMN IF NOT EXISTS source_hash text,
  ADD COLUMN IF NOT EXISTS refreshed_at timestamptz,
  ADD COLUMN IF NOT EXISTS stale_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_user_preference_atoms_user_source_hash ON public.user_preference_atoms (user_id, source_hash) WHERE source_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_evidence_atoms_user_source_hash ON public.user_evidence_atoms (user_id, source_hash) WHERE source_hash IS NOT NULL;

-- 20260523100000_target_atoms_opportunity_company
CREATE TABLE public.opportunity_requirement_atoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid REFERENCES public.canonical_opportunities (id) ON DELETE CASCADE,
  listing_id uuid REFERENCES public.job_listings (id) ON DELETE CASCADE,
  category text NOT NULL,
  dimension text,
  label text NOT NULL,
  normalized_value text,
  description text,
  importance_score integer CHECK (importance_score IS NULL OR (importance_score BETWEEN 1 AND 6)),
  confidence_score numeric,
  source text NOT NULL DEFAULT 'system',
  source_field text,
  source_hash text,
  inferred boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  refreshed_at timestamptz,
  stale_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_requirement_atoms_scope_chk CHECK (opportunity_id IS NOT NULL OR listing_id IS NOT NULL)
);
CREATE INDEX idx_opp_req_atoms_opportunity_id ON public.opportunity_requirement_atoms (opportunity_id);
CREATE INDEX idx_opp_req_atoms_listing_id ON public.opportunity_requirement_atoms (listing_id);
CREATE INDEX idx_opp_req_atoms_category ON public.opportunity_requirement_atoms (category);
CREATE INDEX idx_opp_req_atoms_source_hash ON public.opportunity_requirement_atoms (source_hash) WHERE source_hash IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunity_requirement_atoms TO authenticated;
GRANT ALL ON public.opportunity_requirement_atoms TO service_role;

CREATE TABLE public.company_profile_atoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  category text NOT NULL,
  dimension text,
  label text NOT NULL,
  normalized_value text,
  description text,
  strength_score integer CHECK (strength_score IS NULL OR (strength_score BETWEEN 1 AND 6)),
  confidence_score numeric,
  source text NOT NULL DEFAULT 'system',
  source_hash text,
  inferred boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  refreshed_at timestamptz,
  stale_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cpa_company_id ON public.company_profile_atoms (company_id);
CREATE INDEX idx_cpa_category ON public.company_profile_atoms (category);
CREATE INDEX idx_cpa_source_hash ON public.company_profile_atoms (source_hash) WHERE source_hash IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_profile_atoms TO authenticated;
GRANT ALL ON public.company_profile_atoms TO service_role;

CREATE TABLE public.company_signal_atoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  signal_type text NOT NULL,
  label text NOT NULL,
  description text,
  signal_strength integer CHECK (signal_strength IS NULL OR (signal_strength BETWEEN 1 AND 6)),
  confidence_score numeric,
  observed_at timestamptz,
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'system',
  source_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_csa_company_id ON public.company_signal_atoms (company_id);
CREATE INDEX idx_csa_signal_type ON public.company_signal_atoms (signal_type);
CREATE INDEX idx_csa_source_hash ON public.company_signal_atoms (source_hash) WHERE source_hash IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_signal_atoms TO authenticated;
GRANT ALL ON public.company_signal_atoms TO service_role;

ALTER TABLE public.opportunity_requirement_atoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_profile_atoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_signal_atoms ENABLE ROW LEVEL SECURITY;

CREATE POLICY ora_all_linked ON public.opportunity_requirement_atoms FOR ALL TO authenticated
  USING (
    (opportunity_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_opportunities uo WHERE uo.canonical_opportunity_id = opportunity_requirement_atoms.opportunity_id AND uo.user_id = auth.uid()))
    OR (listing_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_job_listing_status uj WHERE uj.listing_id = opportunity_requirement_atoms.listing_id AND uj.user_id = auth.uid()))
  )
  WITH CHECK (
    (opportunity_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_opportunities uo WHERE uo.canonical_opportunity_id = opportunity_requirement_atoms.opportunity_id AND uo.user_id = auth.uid()))
    OR (listing_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_job_listing_status uj WHERE uj.listing_id = opportunity_requirement_atoms.listing_id AND uj.user_id = auth.uid()))
  );

CREATE POLICY cpa_select_auth ON public.company_profile_atoms FOR SELECT TO authenticated USING (auth.role() = 'authenticated');
CREATE POLICY cpa_insert_linked ON public.company_profile_atoms FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.get_user_employers(auth.uid()) g WHERE g.company_id = company_profile_atoms.company_id));
CREATE POLICY cpa_update_linked ON public.company_profile_atoms FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.get_user_employers(auth.uid()) g WHERE g.company_id = company_profile_atoms.company_id)) WITH CHECK (EXISTS (SELECT 1 FROM public.get_user_employers(auth.uid()) g WHERE g.company_id = company_profile_atoms.company_id));
CREATE POLICY cpa_delete_linked ON public.company_profile_atoms FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.get_user_employers(auth.uid()) g WHERE g.company_id = company_profile_atoms.company_id));

CREATE POLICY csa_select_auth ON public.company_signal_atoms FOR SELECT TO authenticated USING (auth.role() = 'authenticated');
CREATE POLICY csa_insert_linked ON public.company_signal_atoms FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.get_user_employers(auth.uid()) g WHERE g.company_id = company_signal_atoms.company_id));
CREATE POLICY csa_update_linked ON public.company_signal_atoms FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.get_user_employers(auth.uid()) g WHERE g.company_id = company_signal_atoms.company_id)) WITH CHECK (EXISTS (SELECT 1 FROM public.get_user_employers(auth.uid()) g WHERE g.company_id = company_signal_atoms.company_id));
CREATE POLICY csa_delete_linked ON public.company_signal_atoms FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.get_user_employers(auth.uid()) g WHERE g.company_id = company_signal_atoms.company_id));

CREATE TRIGGER set_ora_updated_at BEFORE UPDATE ON public.opportunity_requirement_atoms FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER set_cpa_updated_at BEFORE UPDATE ON public.company_profile_atoms FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER set_csa_updated_at BEFORE UPDATE ON public.company_signal_atoms FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260523101500_list_user_careerjet_leads_canonical_opportunity_id
DROP FUNCTION IF EXISTS public.list_user_careerjet_leads(text);
CREATE FUNCTION public.list_user_careerjet_leads(p_status text DEFAULT 'all')
RETURNS TABLE (
  row_kind text, user_opportunity_id uuid, listing_status_id uuid, listing_id uuid, canonical_opportunity_id uuid,
  status text, relevance_score numeric, ai_score numeric, ai_scored_at timestamptz,
  ai_reasoning text, ai_match_highlights text, ai_concerns text,
  title text, employer text, location text, salary text,
  salary_min numeric, salary_max numeric, salary_currency text,
  published_at timestamptz, source_url text, display_url text, raw_url text, identity_fingerprint text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE filter_status text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  filter_status := lower(btrim(coalesce(p_status, '')));
  IF filter_status NOT IN ('all', 'new', 'saved', 'applied') THEN filter_status := 'all'; END IF;
  RETURN QUERY
  SELECT 'canonical'::text, uo.id, uo.legacy_listing_status_id, uo.legacy_listing_id, uo.canonical_opportunity_id,
    uo.status, uo.relevance_score::numeric, uo.ai_score::numeric, uo.ai_scored_at,
    uo.ai_reasoning, uo.ai_match_highlights, uo.ai_concerns,
    uo.card_title, uo.card_company, uo.card_location, uo.card_salary,
    uo.card_salary_min, uo.card_salary_max, uo.card_salary_currency,
    uo.card_published_at, jl.source_url, uo.card_display_url, uo.card_raw_url, uo.identity_fingerprint
  FROM public.user_opportunities uo
  LEFT JOIN public.user_job_listing_status ujs ON ujs.id = uo.legacy_listing_status_id
  LEFT JOIN public.job_listings jl ON jl.id = COALESCE(uo.legacy_listing_id, ujs.listing_id)
  WHERE uo.user_id = auth.uid()
    AND (filter_status = 'all' AND uo.status <> 'dismissed'
      OR filter_status = 'new' AND uo.status = 'new'
      OR filter_status = 'saved' AND uo.status = 'saved'
      OR filter_status = 'applied' AND uo.status = 'applied');
  RETURN QUERY
  SELECT 'legacy'::text, NULL::uuid, uj.id, jl.id, NULL::uuid,
    uj.status, uj.relevance_score::numeric, uj.ai_score::numeric, uj.ai_scored_at,
    uj.ai_reasoning, uj.ai_match_highlights, uj.ai_concerns,
    jl.title, jl.employer, jl.location, jl.salary,
    jl.salary_min, jl.salary_max, jl.salary_currency,
    jl.published_at, jl.source_url, jl.source_url, jl.source_url,
    public.opportunity_fingerprint(jl.employer, jl.title, jl.location)
  FROM (
    SELECT DISTINCT ON (public.opportunity_fingerprint(jl2.employer, jl2.title, jl2.location))
      uj2.id, uj2.user_id, uj2.status, uj2.relevance_score, uj2.ai_score, uj2.ai_scored_at,
      uj2.ai_reasoning, uj2.ai_match_highlights, uj2.ai_concerns, uj2.listing_id,
      public.opportunity_fingerprint(jl2.employer, jl2.title, jl2.location) AS fp
    FROM public.user_job_listing_status uj2
    JOIN public.job_listings jl2 ON jl2.id = uj2.listing_id
    WHERE uj2.user_id = auth.uid() AND jl2.source = 'careerjet'
      AND NOT EXISTS (SELECT 1 FROM public.user_opportunities uo2 WHERE uo2.user_id = auth.uid()
        AND uo2.identity_fingerprint = public.opportunity_fingerprint(jl2.employer, jl2.title, jl2.location))
      AND (filter_status = 'all' AND uj2.status <> 'dismissed'
        OR filter_status = 'new' AND uj2.status = 'new'
        OR filter_status = 'saved' AND uj2.status = 'saved'
        OR filter_status = 'applied' AND uj2.status = 'applied')
    ORDER BY public.opportunity_fingerprint(jl2.employer, jl2.title, jl2.location), uj2.updated_at DESC NULLS LAST
  ) uj JOIN public.job_listings jl ON jl.id = uj.listing_id;
END; $$;

-- 20260524120000_companies_core_metadata_matching
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS size_estimate text,
  ADD COLUMN IF NOT EXISTS ownership_type text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS description text;
CREATE INDEX IF NOT EXISTS idx_companies_industry_lower ON public.companies (lower(industry));
CREATE INDEX IF NOT EXISTS idx_companies_country_lower ON public.companies (lower(country));
CREATE INDEX IF NOT EXISTS idx_companies_ownership_type_lower ON public.companies (lower(ownership_type));

-- 20260524140000_company_signal_atoms_refresh_metadata
ALTER TABLE public.company_signal_atoms
  ADD COLUMN IF NOT EXISTS refreshed_at timestamptz,
  ADD COLUMN IF NOT EXISTS stale_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_csa_company_id_source_hash ON public.company_signal_atoms (company_id, source_hash) WHERE source_hash IS NOT NULL;

-- 20260525100000_module_5_atom_proposals
CREATE TYPE public.atom_enrichment_batch_status AS ENUM ('open', 'closed', 'cancelled');
CREATE TYPE public.atom_enrichment_proposal_status AS ENUM ('pending_review','approved','rejected','merged','needs_more_context','superseded','expired');
CREATE TYPE public.atom_enrichment_proposal_action AS ENUM ('create_atom','update_atom','merge_atoms','deactivate_atom','flag_conflict','suggest_positioning','suggest_narrative','suggest_evidence','suggest_preference_clarification');

CREATE TABLE public.atom_enrichment_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  title text, notes text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_type text NOT NULL,
  source_id text, source_hash text, source_table text, source_record_id uuid,
  status public.atom_enrichment_batch_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_aeb_user_id ON public.atom_enrichment_batches (user_id);
CREATE INDEX idx_aeb_status ON public.atom_enrichment_batches (status);
CREATE INDEX idx_aeb_source_type ON public.atom_enrichment_batches (source_type);
CREATE INDEX idx_aeb_created_at ON public.atom_enrichment_batches (created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.atom_enrichment_batches TO authenticated;
GRANT ALL ON public.atom_enrichment_batches TO service_role;

CREATE TABLE public.atom_enrichment_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.atom_enrichment_batches (id) ON DELETE CASCADE,
  proposal_action public.atom_enrichment_proposal_action NOT NULL,
  target_atom_type text NOT NULL CHECK (target_atom_type IN ('user_preference_atom','user_evidence_atom','opportunity_requirement_atom','company_profile_atom','company_signal_atom')),
  target_atom_id uuid,
  target_entity_type text, target_entity_id uuid,
  source_type text NOT NULL,
  source_id text, source_hash text, source_table text, source_record_id uuid,
  proposal_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  existing_atom_snapshot jsonb, diff jsonb,
  rationale text, explanation text,
  confidence numeric, inferred boolean NOT NULL DEFAULT true,
  status public.atom_enrichment_proposal_status NOT NULL DEFAULT 'pending_review',
  reviewed_at timestamptz, reviewed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  reviewer_comment text,
  superseded_by_proposal_id uuid REFERENCES public.atom_enrichment_proposals (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_aep_user_id ON public.atom_enrichment_proposals (user_id);
CREATE INDEX idx_aep_batch_id ON public.atom_enrichment_proposals (batch_id);
CREATE INDEX idx_aep_status ON public.atom_enrichment_proposals (status);
CREATE INDEX idx_aep_target ON public.atom_enrichment_proposals (target_atom_type, target_atom_id);
CREATE INDEX idx_aep_source_type ON public.atom_enrichment_proposals (source_type);
CREATE INDEX idx_aep_created_at ON public.atom_enrichment_proposals (created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.atom_enrichment_proposals TO authenticated;
GRANT ALL ON public.atom_enrichment_proposals TO service_role;

ALTER TABLE public.atom_enrichment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atom_enrichment_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY aeb_select_own ON public.atom_enrichment_batches FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY aeb_insert_own ON public.atom_enrichment_batches FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY aeb_update_own ON public.atom_enrichment_batches FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY aeb_delete_own ON public.atom_enrichment_batches FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY aep_select_own ON public.atom_enrichment_proposals FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY aep_insert_own ON public.atom_enrichment_proposals FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.atom_enrichment_batches b WHERE b.id = batch_id AND b.user_id = auth.uid()));
CREATE POLICY aep_update_own ON public.atom_enrichment_proposals FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY aep_delete_own ON public.atom_enrichment_proposals FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE TRIGGER set_aeb_updated_at BEFORE UPDATE ON public.atom_enrichment_batches FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER set_aep_updated_at BEFORE UPDATE ON public.atom_enrichment_proposals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260527205326 (safe — skip missing log_* functions and applications_with_urgency view alter)
DO $$ BEGIN
  EXECUTE 'ALTER VIEW public.applications_with_urgency SET (security_invoker = true)';
EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.refresh_company_aggregate(uuid)','public.set_updated_at()','public.update_updated_at_column()'
  ] LOOP
    BEGIN EXECUTE format('ALTER FUNCTION %s SET search_path = public', fn);
    EXCEPTION WHEN undefined_function THEN NULL; END;
  END LOOP;
END $$;
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.handle_new_user()','public.set_updated_at()','public.update_updated_at_column()','public.prune_stale_leads(uuid)'
  ] LOOP
    BEGIN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXCEPTION WHEN undefined_function THEN NULL; END;
  END LOOP;
END $$;

-- 20260527205351 (safe — function-existence guarded)
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.get_user_employers(uuid)','public.refresh_company_aggregate(uuid)',
    'public.refresh_company_process_aggregate(uuid)',
    'public.register_lead(uuid, text, smallint, text, text, uuid)'
  ] LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    EXCEPTION WHEN undefined_function THEN NULL; END;
  END LOOP;
END $$;

-- 20260529120000_create_job_documents_bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('job-documents', 'job-documents', false) ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS users_select_own_documents ON storage.objects;
CREATE POLICY users_select_own_documents ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'job-documents' AND auth.uid()::text = (storage.foldername(name))[1]);
DROP POLICY IF EXISTS users_upload_own_documents ON storage.objects;
CREATE POLICY users_upload_own_documents ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'job-documents' AND auth.uid()::text = (storage.foldername(name))[1]);
DROP POLICY IF EXISTS users_update_own_documents ON storage.objects;
CREATE POLICY users_update_own_documents ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'job-documents' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'job-documents' AND auth.uid()::text = (storage.foldername(name))[1]);
DROP POLICY IF EXISTS users_delete_own_documents ON storage.objects;
CREATE POLICY users_delete_own_documents ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'job-documents' AND auth.uid()::text = (storage.foldername(name))[1]);

NOTIFY pgrst, 'reload schema';