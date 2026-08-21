-- 1) Avstemmingslinje (thread) per bruker, domene og kildeidentitet
CREATE TABLE public.linkedin_reconciliation_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  proposal_domain text NOT NULL,
  thread_key text NOT NULL,
  current_proposal_id uuid REFERENCES public.linkedin_reconciliation_proposals(id) ON DELETE SET NULL,
  last_source_snapshot_hash text,
  last_status text,
  reopen_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linkedin_reconciliation_threads_unique UNIQUE (user_id, proposal_domain, thread_key),
  CONSTRAINT linkedin_reconciliation_threads_id_user_key UNIQUE (id, user_id)
);

GRANT SELECT ON public.linkedin_reconciliation_threads TO authenticated;
GRANT ALL ON public.linkedin_reconciliation_threads TO service_role;
ALTER TABLE public.linkedin_reconciliation_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own reconciliation threads readable"
  ON public.linkedin_reconciliation_threads FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX linkedin_reconciliation_threads_user_idx
  ON public.linkedin_reconciliation_threads (user_id, proposal_domain);

-- Forslag kan peke tilbake på hvilken linje det tilhører
ALTER TABLE public.linkedin_reconciliation_proposals
  ADD COLUMN IF NOT EXISTS thread_id uuid,
  ADD CONSTRAINT linkedin_reconciliation_proposals_thread_fk
    FOREIGN KEY (thread_id, user_id)
    REFERENCES public.linkedin_reconciliation_threads(id, user_id) ON DELETE CASCADE;

-- 2) next_steps: bruker-scopede sammensatte FK-er, valgfri application_id
ALTER TABLE public.applications ADD CONSTRAINT applications_id_user_key UNIQUE (id, user_id);
ALTER TABLE public.user_opportunities ADD CONSTRAINT user_opportunities_id_user_key UNIQUE (id, user_id);

ALTER TABLE public.next_steps ALTER COLUMN application_id DROP NOT NULL;

ALTER TABLE public.next_steps DROP CONSTRAINT next_steps_application_id_fkey;
ALTER TABLE public.next_steps DROP CONSTRAINT next_steps_contact_id_fkey;
ALTER TABLE public.next_steps DROP CONSTRAINT next_steps_opportunity_id_fkey;

ALTER TABLE public.next_steps
  ADD CONSTRAINT next_steps_application_user_fk
    FOREIGN KEY (application_id, user_id)
    REFERENCES public.applications(id, user_id) ON DELETE CASCADE,
  ADD CONSTRAINT next_steps_contact_user_fk
    FOREIGN KEY (contact_id, user_id)
    REFERENCES public.network_contacts(id, user_id) ON DELETE CASCADE,
  ADD CONSTRAINT next_steps_opportunity_user_fk
    FOREIGN KEY (opportunity_id, user_id)
    REFERENCES public.user_opportunities(id, user_id) ON DELETE CASCADE;

-- Gamle søknadsbaserte policyer erstattes av eierpolicyen på user_id
DROP POLICY IF EXISTS "next_steps_select_own" ON public.next_steps;
DROP POLICY IF EXISTS "next_steps_insert_own" ON public.next_steps;
DROP POLICY IF EXISTS "next_steps_update_own" ON public.next_steps;
DROP POLICY IF EXISTS "next_steps_delete_own" ON public.next_steps;

-- 3) Kanonisk LinkedIn-identitet: ingen duplisering på kontakten
ALTER TABLE public.network_contacts
  ADD COLUMN IF NOT EXISTS last_observed_at timestamptz;
ALTER TABLE public.network_contacts DROP COLUMN IF EXISTS linkedin_profile_url;

-- 4) Kurs som egen atomtype
ALTER TABLE public.career_atoms DROP CONSTRAINT career_atoms_atom_type_check;
ALTER TABLE public.career_atoms ADD CONSTRAINT career_atoms_atom_type_check
  CHECK (atom_type = ANY (ARRAY['role','achievement','metric','context','tool','education','skill','domain','language','certification','course','project','volunteer','summary_fragment']));

CREATE OR REPLACE FUNCTION public.linkedin_promote_qualification(p_proposal_id uuid, p_resolution text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_gate jsonb;
  v_user uuid;
  v_payload jsonb;
  v_type text;
  v_label text;
  v_atom_id uuid;
  v_event uuid;
BEGIN
  v_gate := public._linkedin_promotion_gate(p_proposal_id, p_resolution, ARRAY['learning','profile']);
  IF NOT (v_gate->>'ok')::boolean THEN RETURN v_gate; END IF;
  v_user := (v_gate->>'user_id')::uuid;
  v_payload := v_gate->'payload';
  v_type := coalesce(v_payload->>'atom_type', v_payload->>'qualification_kind', 'course');
  v_label := nullif(btrim(coalesce(v_payload->>'title', v_payload->>'name', v_payload->>'label', '')), '');

  IF v_type NOT IN ('education','certification','language','course') THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'unsupported_qualification_type', 'retryable', false);
  END IF;
  IF v_label IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'empty_source_value', 'retryable', false);
  END IF;
  IF p_resolution <> 'create_new' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_resolution_for_domain', 'retryable', false);
  END IF;

  BEGIN
    INSERT INTO public.career_atoms (
      user_id, atom_kind, atom_type, content_no, structured_data,
      source_type, source_ref, confidence, user_confirmed
    )
    VALUES (
      v_user, 'evidens', v_type, v_label, v_payload, 'linkedin_export',
      'linkedin_import:' || (v_gate->>'import_id') || ':proposal:' || p_proposal_id::text,
      'imported', false
    )
    RETURNING id INTO v_atom_id;

    v_event := public._linkedin_promotion_commit(
      v_gate, p_proposal_id, 'promote_qualification', p_resolution,
      jsonb_build_array(jsonb_build_object('entity_type','career_atom','entity_id',v_atom_id::text,'entity_label',v_label))
    );
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'already_promoted', 'retryable', false);
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'promotion_write_failed', 'retryable', true);
  END;

  RETURN jsonb_build_object('ok', true, 'promotion_event_id', v_event, 'status', 'promoted', 'career_atom_id', v_atom_id);
END;
$function$;

-- 5) Rettigheter: ingen anon-grants
REVOKE ALL ON public.career_recommendations FROM anon;
REVOKE ALL ON public.network_contact_identities FROM anon;