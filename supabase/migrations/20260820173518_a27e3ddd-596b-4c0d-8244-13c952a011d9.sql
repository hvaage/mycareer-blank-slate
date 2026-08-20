-- trigger-funksjonen skal ikke være kallbar utenfra
REVOKE EXECUTE ON FUNCTION public.linkedin_reconciliation_decisions_append_only() FROM PUBLIC, anon, authenticated;

-- =========================================================
-- Dataminimering: forslag som mister sitt kildebelegg
-- =========================================================
CREATE OR REPLACE FUNCTION public.linkedin_reconciliation_minimize_stale(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stale integer := 0;
BEGIN
  WITH affected AS (
    SELECT p.id
    FROM public.linkedin_reconciliation_proposals p
    WHERE p.user_id = p_user_id
      AND p.minimized_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.linkedin_reconciliation_proposal_sources s
        WHERE s.proposal_id = p.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.linkedin_reconciliation_proposal_sources s
        JOIN public.linkedin_staging_records sr ON sr.id = s.linkedin_staging_record_id
        WHERE s.proposal_id = p.id
      )
  ),
  stripped AS (
    UPDATE public.linkedin_reconciliation_proposals p
    SET status = CASE
                   WHEN p.status IN ('dismissed','superseded') THEN p.status
                   ELSE 'stale_source'
                 END,
        source_snapshot_json = '{}'::jsonb,
        target_snapshot_json = NULL,
        proposed_payload_json = NULL,
        comparison_json = '{}'::jsonb,
        review_message = NULL,
        minimized_at = now(),
        updated_at = now()
    FROM affected a
    WHERE p.id = a.id
    RETURNING p.id
  )
  SELECT count(*) INTO v_stale FROM stripped;

  -- fjern koblinger som peker på slettet staging (minimalt revisjonsspor beholdes i forslaget)
  DELETE FROM public.linkedin_reconciliation_proposal_sources s
  WHERE s.user_id = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.linkedin_staging_records sr WHERE sr.id = s.linkedin_staging_record_id
    );

  RETURN v_stale;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.linkedin_reconciliation_minimize_stale(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.linkedin_reconciliation_minimize_stale(uuid) TO service_role;

-- =========================================================
-- Beslutningskontrakt
-- =========================================================
CREATE OR REPLACE FUNCTION public.linkedin_reconciliation_decide(
  p_proposal_id uuid,
  p_decision text,
  p_reason_code text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_proposal public.linkedin_reconciliation_proposals%ROWTYPE;
  v_new_status text;
  v_prev_decision uuid;
  v_decision_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF p_decision NOT IN ('approve_for_promotion','dismiss','defer','request_manual_edit','mark_not_mine') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_decision');
  END IF;

  IF p_reason_code IS NOT NULL AND p_reason_code NOT IN
     ('keep_existing','already_exists','not_relevant','wrong_person','wrong_company','outdated','do_not_import','other') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_reason_code');
  END IF;

  SELECT * INTO v_proposal
  FROM public.linkedin_reconciliation_proposals
  WHERE id = p_proposal_id AND user_id = v_user
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'proposal_not_found');
  END IF;

  IF v_proposal.status IN ('stale_source','stale_target','superseded') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'proposal_not_actionable', 'status', v_proposal.status);
  END IF;

  v_new_status := CASE p_decision
    WHEN 'approve_for_promotion' THEN 'approved_for_promotion'
    WHEN 'dismiss' THEN 'dismissed'
    WHEN 'mark_not_mine' THEN 'dismissed'
    WHEN 'defer' THEN 'deferred_by_user'
    WHEN 'request_manual_edit' THEN 'needs_resolution'
  END;

  IF p_decision = 'mark_not_mine' AND p_reason_code IS NULL THEN
    p_reason_code := 'wrong_person';
  END IF;

  SELECT id INTO v_prev_decision
  FROM public.linkedin_reconciliation_decisions
  WHERE proposal_id = p_proposal_id AND user_id = v_user
  ORDER BY decided_at DESC
  LIMIT 1;

  INSERT INTO public.linkedin_reconciliation_decisions
    (user_id, proposal_id, decision, reason_code, note, resulting_status, supersedes_decision_id)
  VALUES
    (v_user, p_proposal_id, p_decision, p_reason_code, nullif(btrim(coalesce(p_note,'')), ''), v_new_status, v_prev_decision)
  RETURNING id INTO v_decision_id;

  UPDATE public.linkedin_reconciliation_proposals
  SET status = v_new_status,
      updated_at = now()
  WHERE id = p_proposal_id;

  RETURN jsonb_build_object(
    'ok', true,
    'proposal_id', p_proposal_id,
    'decision_id', v_decision_id,
    'status', v_new_status
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.linkedin_reconciliation_decide(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.linkedin_reconciliation_decide(uuid, text, text, text) TO authenticated, service_role;