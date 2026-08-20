-- =========================================================
-- Fase 3: LinkedIn-avstemmingslag (isolert fra CV/atomisering)
-- =========================================================

CREATE TABLE public.linkedin_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  linkedin_import_id uuid NOT NULL,
  purpose text NOT NULL,
  reconciliation_version text NOT NULL DEFAULT 'linkedin_reconciliation_v1',
  normalization_version text NOT NULL DEFAULT 'linkedin_identity_v1',
  status text NOT NULL DEFAULT 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  input_signature text NOT NULL,
  source_record_count integer NOT NULL DEFAULT 0,
  proposal_count integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  match_count integer NOT NULL DEFAULT 0,
  possible_duplicate_count integer NOT NULL DEFAULT 0,
  conflict_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  skip_reason text,
  domain_status jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linkedin_reconciliation_runs_purpose_check
    CHECK (purpose = ANY (ARRAY['profile','career','network','jobs','learning','content'])),
  CONSTRAINT linkedin_reconciliation_runs_status_check
    CHECK (status = ANY (ARRAY['queued','running','succeeded','partially_succeeded','failed','cancelled'])),
  CONSTRAINT linkedin_reconciliation_runs_skip_reason_check
    CHECK (skip_reason IS NULL OR skip_reason = ANY (ARRAY['skipped_no_selected_purpose','skipped_no_source_records','skipped_import_purged'])),
  CONSTRAINT linkedin_reconciliation_runs_import_fk
    FOREIGN KEY (linkedin_import_id, user_id) REFERENCES public.linkedin_imports(id, user_id) ON DELETE CASCADE,
  CONSTRAINT linkedin_reconciliation_runs_id_user_key UNIQUE (id, user_id)
);

-- idempotens: én aktiv kjøring per identisk input
CREATE UNIQUE INDEX linkedin_reconciliation_runs_signature_key
  ON public.linkedin_reconciliation_runs (user_id, input_signature)
  WHERE status <> 'cancelled';

CREATE INDEX linkedin_reconciliation_runs_import_idx
  ON public.linkedin_reconciliation_runs (user_id, linkedin_import_id, purpose);

CREATE TABLE public.linkedin_reconciliation_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  reconciliation_run_id uuid NOT NULL,
  linkedin_import_id uuid NOT NULL,
  purpose text NOT NULL,
  proposal_domain text NOT NULL,
  proposal_kind text NOT NULL,
  status text NOT NULL DEFAULT 'pending_review',
  confidence numeric(4,3) NOT NULL DEFAULT 0.5,
  match_method text NOT NULL DEFAULT 'none',
  dedupe_key text NOT NULL,
  source_classification text NOT NULL DEFAULT 'A',
  source_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_snapshot_hash text NOT NULL,
  target_snapshot_json jsonb,
  target_snapshot_hash text,
  proposed_payload_json jsonb,
  comparison_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  review_message text,
  reconciliation_version text NOT NULL DEFAULT 'linkedin_reconciliation_v1',
  supersedes_proposal_id uuid,
  superseded_at timestamptz,
  minimized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linkedin_reconciliation_proposals_purpose_check
    CHECK (purpose = ANY (ARRAY['profile','career','network','jobs','learning','content'])),
  CONSTRAINT linkedin_reconciliation_proposals_domain_check
    CHECK (proposal_domain = ANY (ARRAY['profile','career','network','jobs','learning','content','recommendations','endorsements'])),
  CONSTRAINT linkedin_reconciliation_proposals_kind_check
    CHECK (proposal_kind = ANY (ARRAY['create','possible_duplicate','possible_update','conflict','keep_existing','deferred','not_actionable_in_phase_3'])),
  CONSTRAINT linkedin_reconciliation_proposals_status_check
    CHECK (status = ANY (ARRAY['pending_review','approved_for_promotion','dismissed','deferred_by_user','needs_resolution','superseded','stale_source','stale_target'])),
  CONSTRAINT linkedin_reconciliation_proposals_confidence_check
    CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT linkedin_reconciliation_proposals_classification_check
    CHECK (source_classification = ANY (ARRAY['A','B'])),
  CONSTRAINT linkedin_reconciliation_proposals_run_fk
    FOREIGN KEY (reconciliation_run_id, user_id) REFERENCES public.linkedin_reconciliation_runs(id, user_id) ON DELETE CASCADE,
  CONSTRAINT linkedin_reconciliation_proposals_import_fk
    FOREIGN KEY (linkedin_import_id, user_id) REFERENCES public.linkedin_imports(id, user_id) ON DELETE CASCADE,
  CONSTRAINT linkedin_reconciliation_proposals_supersedes_fk
    FOREIGN KEY (supersedes_proposal_id) REFERENCES public.linkedin_reconciliation_proposals(id) ON DELETE SET NULL,
  CONSTRAINT linkedin_reconciliation_proposals_id_user_key UNIQUE (id, user_id),
  CONSTRAINT linkedin_reconciliation_proposals_run_dedupe_key UNIQUE (reconciliation_run_id, dedupe_key)
);

CREATE INDEX linkedin_reconciliation_proposals_review_idx
  ON public.linkedin_reconciliation_proposals (user_id, linkedin_import_id, proposal_domain, status);

CREATE TABLE public.linkedin_reconciliation_proposal_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL,
  user_id uuid NOT NULL,
  linkedin_staging_record_id uuid NOT NULL,
  source_role text NOT NULL,
  source_reference_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linkedin_reconciliation_proposal_sources_role_check
    CHECK (source_role = ANY (ARRAY['primary','supporting','third_party_signal','third_party_recommendation'])),
  CONSTRAINT linkedin_reconciliation_proposal_sources_proposal_fk
    FOREIGN KEY (proposal_id, user_id) REFERENCES public.linkedin_reconciliation_proposals(id, user_id) ON DELETE CASCADE,
  CONSTRAINT linkedin_reconciliation_proposal_sources_record_fk
    FOREIGN KEY (linkedin_staging_record_id, user_id) REFERENCES public.linkedin_staging_records(id, user_id) ON DELETE CASCADE,
  CONSTRAINT linkedin_reconciliation_proposal_sources_unique
    UNIQUE (proposal_id, linkedin_staging_record_id, source_role)
);

CREATE INDEX linkedin_reconciliation_proposal_sources_record_idx
  ON public.linkedin_reconciliation_proposal_sources (linkedin_staging_record_id);

CREATE TABLE public.linkedin_reconciliation_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  decision text NOT NULL,
  reason_code text,
  note text,
  resulting_status text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  supersedes_decision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linkedin_reconciliation_decisions_decision_check
    CHECK (decision = ANY (ARRAY['approve_for_promotion','dismiss','defer','request_manual_edit','mark_not_mine'])),
  CONSTRAINT linkedin_reconciliation_decisions_reason_check
    CHECK (reason_code IS NULL OR reason_code = ANY (ARRAY['keep_existing','already_exists','not_relevant','wrong_person','wrong_company','outdated','do_not_import','other'])),
  CONSTRAINT linkedin_reconciliation_decisions_proposal_fk
    FOREIGN KEY (proposal_id, user_id) REFERENCES public.linkedin_reconciliation_proposals(id, user_id) ON DELETE CASCADE,
  CONSTRAINT linkedin_reconciliation_decisions_supersedes_fk
    FOREIGN KEY (supersedes_decision_id) REFERENCES public.linkedin_reconciliation_decisions(id) ON DELETE SET NULL,
  CONSTRAINT linkedin_reconciliation_decisions_id_user_key UNIQUE (id, user_id)
);

CREATE INDEX linkedin_reconciliation_decisions_proposal_idx
  ON public.linkedin_reconciliation_decisions (proposal_id, decided_at DESC);

-- append-only: ingen UPDATE/DELETE på beslutninger
CREATE OR REPLACE FUNCTION public.linkedin_reconciliation_decisions_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'linkedin_reconciliation_decisions er append-only';
END;
$$;

CREATE TRIGGER linkedin_reconciliation_decisions_no_mutation
  BEFORE UPDATE OR DELETE ON public.linkedin_reconciliation_decisions
  FOR EACH ROW EXECUTE FUNCTION public.linkedin_reconciliation_decisions_append_only();

-- ---------------------------------------------------------
-- Tilgang: anon ingen, authenticated kun lese egne rader
-- ---------------------------------------------------------
REVOKE ALL ON public.linkedin_reconciliation_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.linkedin_reconciliation_proposals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.linkedin_reconciliation_proposal_sources FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.linkedin_reconciliation_decisions FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.linkedin_reconciliation_runs TO authenticated;
GRANT SELECT ON public.linkedin_reconciliation_proposals TO authenticated;
GRANT SELECT ON public.linkedin_reconciliation_proposal_sources TO authenticated;
GRANT SELECT ON public.linkedin_reconciliation_decisions TO authenticated;

GRANT ALL ON public.linkedin_reconciliation_runs TO service_role;
GRANT ALL ON public.linkedin_reconciliation_proposals TO service_role;
GRANT ALL ON public.linkedin_reconciliation_proposal_sources TO service_role;
GRANT ALL ON public.linkedin_reconciliation_decisions TO service_role;

ALTER TABLE public.linkedin_reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.linkedin_reconciliation_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.linkedin_reconciliation_proposal_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.linkedin_reconciliation_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY linkedin_reconciliation_runs_owner_select
  ON public.linkedin_reconciliation_runs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY linkedin_reconciliation_proposals_owner_select
  ON public.linkedin_reconciliation_proposals FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY linkedin_reconciliation_proposal_sources_owner_select
  ON public.linkedin_reconciliation_proposal_sources FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY linkedin_reconciliation_decisions_owner_select
  ON public.linkedin_reconciliation_decisions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);