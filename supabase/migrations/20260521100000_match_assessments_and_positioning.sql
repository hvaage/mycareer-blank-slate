-- Module 3: Career Intelligence — match assessments, per-dimension explainability, positioning (no production ranking replacement).

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

COMMENT ON TABLE public.match_assessments IS
  'Neutral match assessment header: scores, bands, explainability JSON; targets company and/or opportunity. Does not replace Careerjet or employer AI scores.';

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

COMMENT ON TABLE public.match_dimension_assessments IS
  'Per-dimension slice of a match_assessment: alignment, evidence links, gaps, inferred requirements.';

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

COMMENT ON TABLE public.positioning_recommendations IS
  'Actionable positioning hints (CV, LinkedIn, network, etc.) tied to an assessment; not AI-generated in Module 3.';

ALTER TABLE public.match_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_dimension_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.positioning_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY match_assessments_select_own ON public.match_assessments
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY match_assessments_insert_own ON public.match_assessments
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY match_assessments_update_own ON public.match_assessments
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY match_assessments_delete_own ON public.match_assessments
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY match_dimension_assessments_select_own ON public.match_dimension_assessments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.match_assessments ma WHERE ma.id = assessment_id AND ma.user_id = auth.uid()));
CREATE POLICY match_dimension_assessments_insert_own ON public.match_dimension_assessments
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.match_assessments ma WHERE ma.id = assessment_id AND ma.user_id = auth.uid()));
CREATE POLICY match_dimension_assessments_update_own ON public.match_dimension_assessments
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.match_assessments ma WHERE ma.id = assessment_id AND ma.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.match_assessments ma WHERE ma.id = assessment_id AND ma.user_id = auth.uid()));
CREATE POLICY match_dimension_assessments_delete_own ON public.match_dimension_assessments
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.match_assessments ma WHERE ma.id = assessment_id AND ma.user_id = auth.uid()));

CREATE POLICY positioning_recommendations_select_own ON public.positioning_recommendations
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY positioning_recommendations_insert_own ON public.positioning_recommendations
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY positioning_recommendations_update_own ON public.positioning_recommendations
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY positioning_recommendations_delete_own ON public.positioning_recommendations
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER set_match_assessments_updated_at
  BEFORE UPDATE ON public.match_assessments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_match_dimension_assessments_updated_at
  BEFORE UPDATE ON public.match_dimension_assessments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_positioning_recommendations_updated_at
  BEFORE UPDATE ON public.positioning_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_assessments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_dimension_assessments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.positioning_recommendations TO authenticated;

NOTIFY pgrst, 'reload schema';
