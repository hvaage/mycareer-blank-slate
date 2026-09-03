CREATE OR REPLACE FUNCTION public.linkedin_promote_career_record(
  p_proposal_id uuid,
  p_resolution text,
  p_existing_atom_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_gate jsonb;
  v_user uuid;
  v_payload jsonb;
  v_atom_id uuid;
  v_event uuid;
  v_title text;
  v_company text;
  v_label text;
  v_atom_type text;
  v_content text;
  v_src text;
  v_existing uuid;
BEGIN
  v_gate := public._linkedin_promotion_gate(p_proposal_id, p_resolution, ARRAY['career']);
  IF NOT (v_gate->>'ok')::boolean THEN RETURN v_gate; END IF;
  v_user := (v_gate->>'user_id')::uuid;
  v_payload := v_gate->'payload';
  v_title := nullif(btrim(coalesce(v_payload->>'title','')), '');
  v_company := nullif(btrim(coalesce(v_payload->>'company','')), '');
  v_label := nullif(btrim(coalesce(v_payload->>'label','')), '');
  v_atom_type := nullif(btrim(coalesce(v_payload->>'atom_type','')), '');
  v_src := 'linkedin_import:' || (v_gate->>'import_id') || ':proposal:' || p_proposal_id::text;

  BEGIN
    IF p_resolution = 'link_to_existing' THEN
      IF p_existing_atom_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error_code', 'missing_existing_target', 'retryable', false);
      END IF;

      UPDATE public.career_atoms
      SET structured_data = jsonb_set(
            structured_data,
            '{linkedin_provenance}',
            coalesce(structured_data->'linkedin_provenance', '[]'::jsonb) || jsonb_build_array(
              jsonb_build_object('proposal_id', p_proposal_id, 'import_id', v_gate->>'import_id',
                                 'source_ref', v_src, 'linked_at', now())
            ),
            true
          ),
          updated_at = now()
      WHERE id = p_existing_atom_id AND user_id = v_user AND is_active
      RETURNING id INTO v_atom_id;

      IF v_atom_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error_code', 'existing_target_not_found', 'retryable', false);
      END IF;
    ELSIF p_resolution = 'create_new' THEN
      IF v_title IS NULL AND v_company IS NULL AND v_label IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error_code', 'empty_source_value', 'retryable', false);
      END IF;

      IF v_title IS NULL AND v_company IS NULL THEN
        -- Betegnelsesbaserte oppføringer: ferdighet, språk, kurs, frivillig arbeid.
        v_atom_type := coalesce(v_atom_type, 'skill');
        v_content := v_label;

        SELECT id INTO v_existing
        FROM public.career_atoms
        WHERE user_id = v_user
          AND is_active
          AND atom_type = v_atom_type
          AND lower(btrim(content_no)) = lower(v_label)
        LIMIT 1;

        IF v_existing IS NOT NULL THEN
          RETURN jsonb_build_object('ok', false, 'error_code', 'already_registered',
                                    'retryable', false, 'career_atom_id', v_existing);
        END IF;
      ELSE
        v_atom_type := 'role';
        v_content := btrim(coalesce(v_title,'') ||
          CASE WHEN v_company IS NOT NULL THEN ' · ' || v_company ELSE '' END);
      END IF;

      INSERT INTO public.career_atoms (
        user_id, atom_kind, atom_type, content_no, structured_data,
        source_type, source_ref, confidence, user_confirmed
      )
      VALUES (
        v_user, 'evidens', v_atom_type, v_content, v_payload,
        'linkedin_export', v_src, 'imported', false
      )
      RETURNING id INTO v_atom_id;
    ELSE
      RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_resolution_for_domain', 'retryable', false);
    END IF;

    v_event := public._linkedin_promotion_commit(
      v_gate, p_proposal_id, 'promote_career_record', p_resolution,
      jsonb_build_array(jsonb_build_object('entity_type','career_atom','entity_id',v_atom_id::text,
                                           'entity_label', coalesce(v_title, v_label)))
    );
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'already_promoted', 'retryable', false);
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'promotion_write_failed', 'retryable', true);
  END;

  RETURN jsonb_build_object('ok', true, 'promotion_event_id', v_event, 'status', 'promoted', 'career_atom_id', v_atom_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.linkedin_promote_career_record(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.linkedin_promote_career_record(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.linkedin_promote_career_record(uuid, text, uuid) TO service_role;

-- Sett godkjente forslag som feilet av denne grunnen tilbake til klar for registrering.
UPDATE public.linkedin_reconciliation_proposals p
SET status = 'approved_for_promotion', updated_at = now()
WHERE p.status = 'promotion_failed'
  AND p.proposal_domain = 'career'
  AND nullif(btrim(coalesce(p.proposed_payload_json->>'label','')), '') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.linkedin_promotion_events e
    WHERE e.proposal_id = p.id AND e.error_code = 'empty_source_value'
  );