-- Module 4.5: Target-side atoms (opportunity requirements, company profile, company signals).

CREATE TABLE public.opportunity_requirement_atoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid REFERENCES public.canonical_opportunities (id) ON DELETE CASCADE,
  listing_id uuid REFERENCES public.job_listings (id) ON DELETE CASCADE,

  category text NOT NULL,
  dimension text,

  label text NOT NULL,
  normalized_value text,
  description text,

  importance_score integer CHECK (importance_score IS NULL OR (importance_score >= 1 AND importance_score <= 6)),
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

  CONSTRAINT opportunity_requirement_atoms_scope_chk CHECK (
    opportunity_id IS NOT NULL OR listing_id IS NOT NULL
  )
);

CREATE INDEX idx_opportunity_requirement_atoms_opportunity_id ON public.opportunity_requirement_atoms (opportunity_id);
CREATE INDEX idx_opportunity_requirement_atoms_listing_id ON public.opportunity_requirement_atoms (listing_id);
CREATE INDEX idx_opportunity_requirement_atoms_category ON public.opportunity_requirement_atoms (category);
CREATE INDEX idx_opportunity_requirement_atoms_source_hash ON public.opportunity_requirement_atoms (source_hash)
  WHERE source_hash IS NOT NULL;

COMMENT ON TABLE public.opportunity_requirement_atoms IS
  'Deterministic target-side requirement/capability atoms for a canonical opportunity and/or listing (Module 4.5).';

CREATE TABLE public.company_profile_atoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  category text NOT NULL,
  dimension text,

  label text NOT NULL,
  normalized_value text,
  description text,

  strength_score integer CHECK (strength_score IS NULL OR (strength_score >= 1 AND strength_score <= 6)),
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

CREATE INDEX idx_company_profile_atoms_company_id ON public.company_profile_atoms (company_id);
CREATE INDEX idx_company_profile_atoms_category ON public.company_profile_atoms (category);
CREATE INDEX idx_company_profile_atoms_source_hash ON public.company_profile_atoms (source_hash)
  WHERE source_hash IS NOT NULL;

COMMENT ON TABLE public.company_profile_atoms IS
  'Stable employer/company trait atoms (culture, scale, mission, etc.) derived from stored company data.';

CREATE TABLE public.company_signal_atoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  signal_type text NOT NULL,
  label text NOT NULL,
  description text,

  signal_strength integer CHECK (signal_strength IS NULL OR (signal_strength >= 1 AND signal_strength <= 6)),
  confidence_score numeric,

  observed_at timestamptz,
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,

  source text NOT NULL DEFAULT 'system',
  source_hash text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_signal_atoms_company_id ON public.company_signal_atoms (company_id);
CREATE INDEX idx_company_signal_atoms_signal_type ON public.company_signal_atoms (signal_type);
CREATE INDEX idx_company_signal_atoms_source_hash ON public.company_signal_atoms (source_hash)
  WHERE source_hash IS NOT NULL;

COMMENT ON TABLE public.company_signal_atoms IS
  'Shorter-lived operational / momentum signals for an employer (hiring, change, programs).';

ALTER TABLE public.opportunity_requirement_atoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_profile_atoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_signal_atoms ENABLE ROW LEVEL SECURITY;

CREATE POLICY opportunity_requirement_atoms_all_linked ON public.opportunity_requirement_atoms
  FOR ALL TO authenticated
  USING (
    (
      opportunity_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.user_opportunities uo
        WHERE uo.canonical_opportunity_id = opportunity_requirement_atoms.opportunity_id
          AND uo.user_id = auth.uid()
      )
    )
    OR (
      listing_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.user_job_listing_status uj
        WHERE uj.listing_id = opportunity_requirement_atoms.listing_id
          AND uj.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    (
      opportunity_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.user_opportunities uo
        WHERE uo.canonical_opportunity_id = opportunity_requirement_atoms.opportunity_id
          AND uo.user_id = auth.uid()
      )
    )
    OR (
      listing_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.user_job_listing_status uj
        WHERE uj.listing_id = opportunity_requirement_atoms.listing_id
          AND uj.user_id = auth.uid()
      )
    )
  );

CREATE POLICY company_profile_atoms_select_auth ON public.company_profile_atoms
  FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated');

CREATE POLICY company_profile_atoms_write_if_user_linked ON public.company_profile_atoms
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.get_user_employers(auth.uid()) g
      WHERE g.company_id = company_profile_atoms.company_id
    )
  );

CREATE POLICY company_profile_atoms_update_if_user_linked ON public.company_profile_atoms
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.get_user_employers(auth.uid()) g
      WHERE g.company_id = company_profile_atoms.company_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.get_user_employers(auth.uid()) g
      WHERE g.company_id = company_profile_atoms.company_id
    )
  );

CREATE POLICY company_profile_atoms_delete_if_user_linked ON public.company_profile_atoms
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.get_user_employers(auth.uid()) g
      WHERE g.company_id = company_profile_atoms.company_id
    )
  );

CREATE POLICY company_signal_atoms_select_auth ON public.company_signal_atoms
  FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated');

CREATE POLICY company_signal_atoms_write_if_user_linked ON public.company_signal_atoms
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.get_user_employers(auth.uid()) g
      WHERE g.company_id = company_signal_atoms.company_id
    )
  );

CREATE POLICY company_signal_atoms_update_if_user_linked ON public.company_signal_atoms
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.get_user_employers(auth.uid()) g
      WHERE g.company_id = company_signal_atoms.company_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.get_user_employers(auth.uid()) g
      WHERE g.company_id = company_signal_atoms.company_id
    )
  );

CREATE POLICY company_signal_atoms_delete_if_user_linked ON public.company_signal_atoms
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.get_user_employers(auth.uid()) g
      WHERE g.company_id = company_signal_atoms.company_id
    )
  );

CREATE TRIGGER set_opportunity_requirement_atoms_updated_at
  BEFORE UPDATE ON public.opportunity_requirement_atoms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_company_profile_atoms_updated_at
  BEFORE UPDATE ON public.company_profile_atoms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_company_signal_atoms_updated_at
  BEFORE UPDATE ON public.company_signal_atoms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunity_requirement_atoms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_profile_atoms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_signal_atoms TO authenticated;

NOTIFY pgrst, 'reload schema';
