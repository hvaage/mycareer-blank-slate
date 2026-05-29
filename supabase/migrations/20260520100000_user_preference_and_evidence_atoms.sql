-- Module 2: Career Intelligence — preference atoms vs evidence atoms (foundation only).
-- Preference = what the user values; evidence = what can be documented. No matching logic yet.

CREATE TABLE public.user_preference_atoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  career_profile_id uuid REFERENCES public.user_career_profiles (id) ON DELETE CASCADE,
  dimension text NOT NULL,
  label text NOT NULL,
  value text,
  importance_score integer
    CHECK (importance_score IS NULL OR (importance_score >= 1 AND importance_score <= 6)),
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

COMMENT ON TABLE public.user_preference_atoms IS
  'Structured preference atoms: what the user wants, values, or prioritizes (not exclusions). Feeds future job/employer match and explainability.';

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
  strength_score integer
    CHECK (strength_score IS NULL OR (strength_score >= 1 AND strength_score <= 6)),
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

COMMENT ON TABLE public.user_evidence_atoms IS
  'Structured evidence atoms: what the user can document or source (CV, profile, docs). Feeds gap/whitespace and positioning engines.';

ALTER TABLE public.user_preference_atoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_evidence_atoms ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_preference_atoms_select_own ON public.user_preference_atoms
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY user_preference_atoms_insert_own ON public.user_preference_atoms
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY user_preference_atoms_update_own ON public.user_preference_atoms
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY user_preference_atoms_delete_own ON public.user_preference_atoms
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY user_evidence_atoms_select_own ON public.user_evidence_atoms
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY user_evidence_atoms_insert_own ON public.user_evidence_atoms
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY user_evidence_atoms_update_own ON public.user_evidence_atoms
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY user_evidence_atoms_delete_own ON public.user_evidence_atoms
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER set_user_preference_atoms_updated_at
  BEFORE UPDATE ON public.user_preference_atoms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_user_evidence_atoms_updated_at
  BEFORE UPDATE ON public.user_evidence_atoms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_preference_atoms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_evidence_atoms TO authenticated;

NOTIFY pgrst, 'reload schema';
