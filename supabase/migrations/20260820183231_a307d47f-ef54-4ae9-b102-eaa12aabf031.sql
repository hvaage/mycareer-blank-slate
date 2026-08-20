-- Fase 4: kontrollert promotering av godkjente LinkedIn-forslag (additiv schema)

ALTER TABLE public.linkedin_reconciliation_proposals
  DROP CONSTRAINT IF EXISTS linkedin_reconciliation_proposals_status_check;
ALTER TABLE public.linkedin_reconciliation_proposals
  ADD CONSTRAINT linkedin_reconciliation_proposals_status_check
  CHECK (status = ANY (ARRAY[
    'pending_review','approved_for_promotion','dismissed','deferred_by_user',
    'needs_resolution','superseded','stale_source','stale_target',
    'promoted','promotion_failed'
  ]));

CREATE TABLE IF NOT EXISTS public.linkedin_promotion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  proposal_id uuid,
  decision_id uuid,
  linkedin_import_id uuid,
  purpose text,
  proposal_domain text NOT NULL,
  promotion_action text NOT NULL,
  resolution text,
  promotion_status text NOT NULL,
  retryable boolean NOT NULL DEFAULT false,
  idempotency_key text NOT NULL,
  error_code text,
  error_summary text,
  source_snapshot_hash text,
  target_snapshot_hash_before text,
  target_snapshot_hash_after text,
  promotion_version text NOT NULL DEFAULT 'linkedin_promotion_v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linkedin_promotion_events_id_user_key UNIQUE (id, user_id),
  CONSTRAINT linkedin_promotion_events_status_check
    CHECK (promotion_status = ANY (ARRAY['promoted','promotion_failed'])),
  CONSTRAINT linkedin_promotion_events_resolution_check
    CHECK (resolution IS NULL OR resolution = ANY (ARRAY['create_new','link_to_existing','use_linkedin_value'])),
  CONSTRAINT linkedin_promotion_events_domain_check
    CHECK (proposal_domain = ANY (ARRAY[
      'profile','career','network','jobs','learning','content','recommendations','endorsements'
    ])),
  CONSTRAINT linkedin_promotion_events_error_check
    CHECK (
      (promotion_status = 'promoted' AND error_code IS NULL)
      OR (promotion_status = 'promotion_failed' AND error_code IS NOT NULL)
    ),
  CONSTRAINT linkedin_promotion_events_summary_len CHECK (error_summary IS NULL OR length(error_summary) <= 300)
);

CREATE UNIQUE INDEX IF NOT EXISTS linkedin_promotion_events_success_idem_idx
  ON public.linkedin_promotion_events (user_id, idempotency_key)
  WHERE promotion_status = 'promoted';

CREATE INDEX IF NOT EXISTS linkedin_promotion_events_proposal_idx
  ON public.linkedin_promotion_events (user_id, proposal_id, created_at DESC);

GRANT SELECT ON public.linkedin_promotion_events TO authenticated;
GRANT ALL ON public.linkedin_promotion_events TO service_role;
ALTER TABLE public.linkedin_promotion_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own promotion events readable" ON public.linkedin_promotion_events;
CREATE POLICY "own promotion events readable" ON public.linkedin_promotion_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.linkedin_promotion_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'linkedin_promotion_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS linkedin_promotion_events_no_mutation ON public.linkedin_promotion_events;
CREATE TRIGGER linkedin_promotion_events_no_mutation
  BEFORE UPDATE OR DELETE ON public.linkedin_promotion_events
  FOR EACH ROW EXECUTE FUNCTION public.linkedin_promotion_events_append_only();

CREATE TABLE IF NOT EXISTS public.linkedin_promotion_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  promotion_event_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  entity_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linkedin_promotion_targets_event_fk
    FOREIGN KEY (promotion_event_id, user_id)
    REFERENCES public.linkedin_promotion_events (id, user_id) ON DELETE CASCADE,
  CONSTRAINT linkedin_promotion_targets_entity_type_check
    CHECK (entity_type = ANY (ARRAY[
      'profile_field','user_career_profile_field','career_atom','career_atom_link',
      'career_recommendation','network_contact','career_skill_source_signal','job_lead'
    ])),
  CONSTRAINT linkedin_promotion_targets_unique UNIQUE (promotion_event_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS linkedin_promotion_targets_user_idx
  ON public.linkedin_promotion_targets (user_id, entity_type, entity_id);

GRANT SELECT ON public.linkedin_promotion_targets TO authenticated;
GRANT ALL ON public.linkedin_promotion_targets TO service_role;
ALTER TABLE public.linkedin_promotion_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own promotion targets readable" ON public.linkedin_promotion_targets;
CREATE POLICY "own promotion targets readable" ON public.linkedin_promotion_targets
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.career_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  author_name text,
  author_identity_key text NOT NULL,
  author_title text,
  author_company text,
  relationship_text text,
  recommendation_text text NOT NULL,
  text_hash text NOT NULL,
  recommended_on date,
  source_system text NOT NULL DEFAULT 'linkedin_export',
  source_classification text NOT NULL DEFAULT 'third_party_recommendation',
  source_ref text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT career_recommendations_classification_check
    CHECK (source_classification = 'third_party_recommendation'),
  CONSTRAINT career_recommendations_dedupe UNIQUE (user_id, author_identity_key, text_hash)
);

GRANT SELECT, UPDATE, DELETE ON public.career_recommendations TO authenticated;
GRANT ALL ON public.career_recommendations TO service_role;
ALTER TABLE public.career_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own recommendations readable" ON public.career_recommendations;
CREATE POLICY "own recommendations readable" ON public.career_recommendations
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own recommendations updatable" ON public.career_recommendations;
CREATE POLICY "own recommendations updatable" ON public.career_recommendations
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own recommendations deletable" ON public.career_recommendations;
CREATE POLICY "own recommendations deletable" ON public.career_recommendations
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.network_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  display_name text,
  headline text,
  company text,
  connected_on date,
  source_system text NOT NULL DEFAULT 'linkedin_export',
  source_ref text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT network_contacts_id_user_key UNIQUE (id, user_id)
);

GRANT SELECT, UPDATE, DELETE ON public.network_contacts TO authenticated;
GRANT ALL ON public.network_contacts TO service_role;
ALTER TABLE public.network_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own network contacts readable" ON public.network_contacts;
CREATE POLICY "own network contacts readable" ON public.network_contacts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own network contacts updatable" ON public.network_contacts;
CREATE POLICY "own network contacts updatable" ON public.network_contacts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own network contacts deletable" ON public.network_contacts;
CREATE POLICY "own network contacts deletable" ON public.network_contacts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.network_contact_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  network_contact_id uuid NOT NULL,
  identity_kind text NOT NULL,
  identity_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT network_contact_identities_contact_fk
    FOREIGN KEY (network_contact_id, user_id)
    REFERENCES public.network_contacts (id, user_id) ON DELETE CASCADE,
  CONSTRAINT network_contact_identities_kind_check
    CHECK (identity_kind = ANY (ARRAY['linkedin_profile_url','linkedin_vanity'])),
  CONSTRAINT network_contact_identities_unique UNIQUE (user_id, identity_kind, identity_key)
);

GRANT SELECT, DELETE ON public.network_contact_identities TO authenticated;
GRANT ALL ON public.network_contact_identities TO service_role;
ALTER TABLE public.network_contact_identities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own contact identities readable" ON public.network_contact_identities;
CREATE POLICY "own contact identities readable" ON public.network_contact_identities
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own contact identities deletable" ON public.network_contact_identities;
CREATE POLICY "own contact identities deletable" ON public.network_contact_identities
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.career_skill_source_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  career_atom_id uuid,
  skill_key text NOT NULL,
  skill_label text NOT NULL,
  signal_type text NOT NULL,
  signal_count integer NOT NULL DEFAULT 0,
  source_system text NOT NULL DEFAULT 'linkedin_export',
  source_ref text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT career_skill_source_signals_type_check
    CHECK (signal_type = ANY (ARRAY['endorsement_count','self_reported_linkedin'])),
  CONSTRAINT career_skill_source_signals_unique UNIQUE (user_id, skill_key, signal_type, source_system)
);

GRANT SELECT, DELETE ON public.career_skill_source_signals TO authenticated;
GRANT ALL ON public.career_skill_source_signals TO service_role;
ALTER TABLE public.career_skill_source_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own skill signals readable" ON public.career_skill_source_signals;
CREATE POLICY "own skill signals readable" ON public.career_skill_source_signals
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own skill signals deletable" ON public.career_skill_source_signals;
CREATE POLICY "own skill signals deletable" ON public.career_skill_source_signals
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

ALTER TABLE public.job_leads ADD COLUMN IF NOT EXISTS source_system text;
ALTER TABLE public.job_leads ADD COLUMN IF NOT EXISTS source_url_hash text;
ALTER TABLE public.job_leads ADD COLUMN IF NOT EXISTS source_observed_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS job_leads_source_url_hash_idx
  ON public.job_leads (user_id, source_system, source_url_hash)
  WHERE source_url_hash IS NOT NULL;