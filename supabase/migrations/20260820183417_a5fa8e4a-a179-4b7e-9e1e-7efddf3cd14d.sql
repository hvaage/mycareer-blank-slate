-- Fase 4: promoteringsport

REVOKE EXECUTE ON FUNCTION public.linkedin_promotion_events_append_only() FROM PUBLIC, anon, authenticated;

-- Felles forkontroll -------------------------------------------------------
CREATE OR REPLACE FUNCTION public._linkedin_promotion_gate(
  p_proposal_id uuid,
  p_resolution text,
  p_expected_domains text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_p public.linkedin_reconciliation_proposals%ROWTYPE;
  v_import public.linkedin_imports%ROWTYPE;
  v_decision uuid;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'not_authenticated', 'retryable', false);
  END IF;

  IF p_resolution IN ('keep_existing','manual_edit_required') THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'resolution_requires_decision_layer', 'retryable', false);
  END IF;

  IF p_resolution IS NULL OR p_resolution NOT IN ('create_new','link_to_existing','use_linkedin_value') THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_resolution', 'retryable', false);
  END IF;

  SELECT * INTO v_p
  FROM public.linkedin_reconciliation_proposals
  WHERE id = p_proposal_id AND user_id = v_user
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'proposal_not_found', 'retryable', false);
  END IF;

  IF v_p.status = 'promoted' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'already_promoted', 'retryable', false);
  END IF;

  IF v_p.status <> 'approved_for_promotion' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'not_approved_for_promotion', 'retryable', false, 'status', v_p.status);
  END IF;

  IF NOT (v_p.proposal_domain = ANY (p_expected_domains)) THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'wrong_promotion_port', 'retryable', false);
  END IF;

  IF v_p.source_classification <> 'A' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'source_class_blocked', 'retryable', false);
  END IF;

  IF v_p.minimized_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'source_minimized', 'retryable', false);
  END IF;

  SELECT * INTO v_import
  FROM public.linkedin_imports
  WHERE id = v_p.linkedin_import_id AND user_id = v_user;

  IF NOT FOUND OR v_import.purged_at IS NOT NULL OR v_import.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'import_inactive', 'retryable', false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.linkedin_import_purposes
    WHERE linkedin_import_id = v_p.linkedin_import_id AND user_id = v_user AND purpose = v_p.purpose
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'skipped_no_selected_purpose', 'retryable', false);
  END IF;

  SELECT id INTO v_decision
  FROM public.linkedin_reconciliation_decisions
  WHERE proposal_id = p_proposal_id AND user_id = v_user
  ORDER BY decided_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_user,
    'decision_id', v_decision,
    'domain', v_p.proposal_domain,
    'purpose', v_p.purpose,
    'import_id', v_p.linkedin_import_id,
    'payload', coalesce(v_p.proposed_payload_json, '{}'::jsonb),
    'source_snapshot', v_p.source_snapshot_json,
    'source_snapshot_hash', v_p.source_snapshot_hash,
    'target_snapshot', v_p.target_snapshot_json,
    'target_snapshot_hash', v_p.target_snapshot_hash
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._linkedin_promotion_gate(uuid, text, text[]) FROM PUBLIC, anon, authenticated;

-- Felles suksesskvittering -------------------------------------------------
CREATE OR REPLACE FUNCTION public._linkedin_promotion_commit(
  p_gate jsonb,
  p_proposal_id uuid,
  p_action text,
  p_resolution text,
  p_targets jsonb,
  p_target_hash_after text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := (p_gate->>'user_id')::uuid;
  v_event_id uuid;
  v_target jsonb;
BEGIN
  INSERT INTO public.linkedin_promotion_events (
    user_id, proposal_id, decision_id, linkedin_import_id, purpose,
    proposal_domain, promotion_action, resolution, promotion_status,
    idempotency_key, source_snapshot_hash, target_snapshot_hash_before, target_snapshot_hash_after
  )
  VALUES (
    v_user, p_proposal_id, nullif(p_gate->>'decision_id','')::uuid,
    (p_gate->>'import_id')::uuid, p_gate->>'purpose',
    p_gate->>'domain', p_action, p_resolution, 'promoted',
    p_proposal_id::text || ':' || p_action || ':' || p_resolution,
    p_gate->>'source_snapshot_hash', p_gate->>'target_snapshot_hash', p_target_hash_after
  )
  RETURNING id INTO v_event_id;

  FOR v_target IN SELECT * FROM jsonb_array_elements(coalesce(p_targets, '[]'::jsonb))
  LOOP
    INSERT INTO public.linkedin_promotion_targets (user_id, promotion_event_id, entity_type, entity_id, entity_label)
    VALUES (v_user, v_event_id, v_target->>'entity_type', v_target->>'entity_id', v_target->>'entity_label')
    ON CONFLICT (promotion_event_id, entity_type, entity_id) DO NOTHING;
  END LOOP;

  UPDATE public.linkedin_reconciliation_proposals
  SET status = 'promoted', updated_at = now()
  WHERE id = p_proposal_id AND user_id = v_user;

  RETURN v_event_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._linkedin_promotion_commit(jsonb, uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;

-- Separat, append-only feilhendelse ----------------------------------------
CREATE OR REPLACE FUNCTION public.linkedin_promotion_record_failure(
  p_proposal_id uuid,
  p_action text,
  p_error_code text,
  p_retryable boolean,
  p_error_summary text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_p public.linkedin_reconciliation_proposals%ROWTYPE;
  v_event_id uuid;
  v_summary text;
  v_status text;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF p_error_code IS NULL OR btrim(p_error_code) = '' OR p_error_code !~ '^[a-z0-9_]{3,60}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_error_code');
  END IF;

  SELECT * INTO v_p
  FROM public.linkedin_reconciliation_proposals
  WHERE id = p_proposal_id AND user_id = v_user
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'proposal_not_found');
  END IF;

  -- Sanitering: kun kort, kontrollert tekst. Aldri rå kildeinnhold eller databasefeil.
  v_summary := nullif(btrim(coalesce(p_error_summary, '')), '');
  IF v_summary IS NOT NULL THEN
    v_summary := left(regexp_replace(v_summary, '[^\w æøåÆØÅ\.\,\-\:]', '', 'g'), 300);
  END IF;

  INSERT INTO public.linkedin_promotion_events (
    user_id, proposal_id, linkedin_import_id, purpose, proposal_domain,
    promotion_action, promotion_status, retryable, idempotency_key,
    error_code, error_summary, source_snapshot_hash, target_snapshot_hash_before
  )
  VALUES (
    v_user, p_proposal_id, v_p.linkedin_import_id, v_p.purpose, v_p.proposal_domain,
    coalesce(nullif(btrim(p_action), ''), 'unknown'), 'promotion_failed', coalesce(p_retryable, false),
    p_proposal_id::text || ':failure:' || gen_random_uuid()::text,
    p_error_code, v_summary, v_p.source_snapshot_hash, v_p.target_snapshot_hash
  )
  RETURNING id INTO v_event_id;

  -- Retry-regel: retrybare feil lar forslaget stå godkjent, ikke-retrybare låses.
  IF coalesce(p_retryable, false) THEN
    v_status := v_p.status;
  ELSE
    v_status := 'promotion_failed';
    UPDATE public.linkedin_reconciliation_proposals
    SET status = 'promotion_failed', updated_at = now()
    WHERE id = p_proposal_id AND user_id = v_user;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'event_id', v_event_id,
    'proposal_status', v_status,
    'retryable', coalesce(p_retryable, false),
    'reopen_via', CASE WHEN coalesce(p_retryable, false) THEN NULL ELSE 'linkedin_reconciliation_decide' END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.linkedin_promotion_record_failure(uuid, text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.linkedin_promotion_record_failure(uuid, text, text, boolean, text) TO authenticated, service_role;

-- Gjenåpning av et ikke-retrybart feilet forslag ---------------------------
CREATE OR REPLACE FUNCTION public.linkedin_promotion_reopen(p_proposal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_status text;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT status INTO v_status
  FROM public.linkedin_reconciliation_proposals
  WHERE id = p_proposal_id AND user_id = v_user
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'proposal_not_found');
  END IF;

  IF v_status <> 'promotion_failed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_reopenable', 'status', v_status);
  END IF;

  UPDATE public.linkedin_reconciliation_proposals
  SET status = 'needs_resolution', updated_at = now()
  WHERE id = p_proposal_id AND user_id = v_user;

  RETURN jsonb_build_object('ok', true, 'status', 'needs_resolution');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.linkedin_promotion_reopen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.linkedin_promotion_reopen(uuid) TO authenticated, service_role;