-- Module 5: AI-assisted atom enrichment — durable proposal + review foundation.
-- Additive only; does not alter existing atom tables or refresh logic.

CREATE TYPE public.atom_enrichment_batch_status AS ENUM ('open', 'closed', 'cancelled');

CREATE TYPE public.atom_enrichment_proposal_status AS ENUM (
  'pending_review',
  'approved',
  'rejected',
  'merged',
  'needs_more_context',
  'superseded',
  'expired'
);

CREATE TYPE public.atom_enrichment_proposal_action AS ENUM (
  'create_atom',
  'update_atom',
  'merge_atoms',
  'deactivate_atom',
  'flag_conflict',
  'suggest_positioning',
  'suggest_narrative',
  'suggest_evidence',
  'suggest_preference_clarification'
);

CREATE TABLE public.atom_enrichment_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  title text,
  notes text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_type text NOT NULL,
  source_id text,
  source_hash text,
  source_table text,
  source_record_id uuid,
  status public.atom_enrichment_batch_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_atom_enrichment_batches_user_id ON public.atom_enrichment_batches (user_id);
CREATE INDEX idx_atom_enrichment_batches_status ON public.atom_enrichment_batches (status);
CREATE INDEX idx_atom_enrichment_batches_source_type ON public.atom_enrichment_batches (source_type);
CREATE INDEX idx_atom_enrichment_batches_created_at ON public.atom_enrichment_batches (created_at DESC);

COMMENT ON TABLE public.atom_enrichment_batches IS
  'Logical grouping for atom enrichment proposals (CV, employer analysis, job context, future multi-source).';

CREATE TABLE public.atom_enrichment_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.atom_enrichment_batches (id) ON DELETE CASCADE,

  proposal_action public.atom_enrichment_proposal_action NOT NULL,

  target_atom_type text NOT NULL
    CHECK (target_atom_type IN (
      'user_preference_atom',
      'user_evidence_atom',
      'opportunity_requirement_atom',
      'company_profile_atom',
      'company_signal_atom'
    )),

  target_atom_id uuid,
  target_entity_type text,
  target_entity_id uuid,

  source_type text NOT NULL,
  source_id text,
  source_hash text,
  source_table text,
  source_record_id uuid,

  proposal_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  existing_atom_snapshot jsonb,
  diff jsonb,

  rationale text,
  explanation text,

  confidence numeric,
  inferred boolean NOT NULL DEFAULT true,

  status public.atom_enrichment_proposal_status NOT NULL DEFAULT 'pending_review',

  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  reviewer_comment text,

  superseded_by_proposal_id uuid REFERENCES public.atom_enrichment_proposals (id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_atom_enrichment_proposals_user_id ON public.atom_enrichment_proposals (user_id);
CREATE INDEX idx_atom_enrichment_proposals_batch_id ON public.atom_enrichment_proposals (batch_id);
CREATE INDEX idx_atom_enrichment_proposals_status ON public.atom_enrichment_proposals (status);
CREATE INDEX idx_atom_enrichment_proposals_target_atom
  ON public.atom_enrichment_proposals (target_atom_type, target_atom_id);
CREATE INDEX idx_atom_enrichment_proposals_source_type ON public.atom_enrichment_proposals (source_type);
CREATE INDEX idx_atom_enrichment_proposals_created_at ON public.atom_enrichment_proposals (created_at DESC);

COMMENT ON TABLE public.atom_enrichment_proposals IS
  'Reviewable proposals before durable writes to preference/evidence/target atoms; preserves snapshots and provenance.';

ALTER TABLE public.atom_enrichment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atom_enrichment_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY atom_enrichment_batches_select_own ON public.atom_enrichment_batches
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY atom_enrichment_batches_insert_own ON public.atom_enrichment_batches
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY atom_enrichment_batches_update_own ON public.atom_enrichment_batches
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY atom_enrichment_batches_delete_own ON public.atom_enrichment_batches
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY atom_enrichment_proposals_select_own ON public.atom_enrichment_proposals
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY atom_enrichment_proposals_insert_own ON public.atom_enrichment_proposals
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.atom_enrichment_batches b
      WHERE b.id = batch_id AND b.user_id = auth.uid()
    )
  );

CREATE POLICY atom_enrichment_proposals_update_own ON public.atom_enrichment_proposals
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY atom_enrichment_proposals_delete_own ON public.atom_enrichment_proposals
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER set_atom_enrichment_batches_updated_at
  BEFORE UPDATE ON public.atom_enrichment_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_atom_enrichment_proposals_updated_at
  BEFORE UPDATE ON public.atom_enrichment_proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.atom_enrichment_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.atom_enrichment_proposals TO authenticated;

NOTIFY pgrst, 'reload schema';
