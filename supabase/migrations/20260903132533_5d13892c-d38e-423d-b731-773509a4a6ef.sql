CREATE OR REPLACE FUNCTION public.linkedin_promote_skill_or_signal(
  p_proposal_id uuid,
  p_resolution text,
  p_existing_atom_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_gate jsonb;
  v_user uuid;
  v_payload jsonb;
  v_label text;
  v_key text;
  v_atom_id uuid;
  v_signal_id uuid;
  v_count integer;
  v_event uuid;
  v_targets jsonb := '[]'::jsonb;
  v_already_registered boolean := false;
BEGIN
  v_gate := public._linkedin_promotion_gate(
    p_proposal_id,
    p_resolution,
    ARRAY['profile','career','endorsements']
  );
  IF NOT (v_gate->>'ok')::boolean THEN
    RETURN v_gate;
  END IF;

  v_user := (v_gate->>'user_id')::uuid;
  v_payload := v_gate->'payload';
  v_label := nullif(btrim(coalesce(
    v_payload->>'skill',
    v_payload->>'label',
    v_payload->>'title',
    v_payload->>'name',
    ''
  )), '');

  IF v_label IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error_code', 'empty_source_value',
      'retryable', false
    );
  END IF;

  v_key := lower(regexp_replace(v_label, '\s+', ' ', 'g'));
  v_count := coalesce((v_payload->>'endorsement_count')::integer, 0);

  BEGIN
    IF p_resolution = 'create_new' THEN
      SELECT ca.id
      INTO v_atom_id
      FROM public.career_atoms AS ca
      WHERE ca.user_id = v_user
        AND ca.is_active
        AND ca.atom_type = 'skill'
        AND lower(regexp_replace(btrim(ca.content_no), '\s+', ' ', 'g')) = v_key
      ORDER BY ca.created_at
      LIMIT 1;

      IF v_atom_id IS NULL THEN
        INSERT INTO public.career_atoms (
          user_id, atom_kind, atom_type, content_no, structured_data,
          source_type, source_ref, confidence, user_confirmed
        )
        VALUES (
          v_user,
          'evidens',
          'skill',
          v_label,
          v_payload || jsonb_build_object('self_reported_linkedin', true),
          'linkedin_export',
          'linkedin_import:' || (v_gate->>'import_id') || ':proposal:' || p_proposal_id::text,
          'imported',
          false
        )
        RETURNING id INTO v_atom_id;
      ELSE
        v_already_registered := true;
      END IF;
    ELSIF p_resolution = 'link_to_existing' THEN
      SELECT ca.id
      INTO v_atom_id
      FROM public.career_atoms AS ca
      WHERE ca.id = p_existing_atom_id
        AND ca.user_id = v_user
        AND ca.is_active
        AND ca.atom_type = 'skill';

      IF v_atom_id IS NULL THEN
        RETURN jsonb_build_object(
          'ok', false,
          'error_code', 'existing_target_not_found',
          'retryable', false
        );
      END IF;
      v_already_registered := true;
    ELSE
      RETURN jsonb_build_object(
        'ok', false,
        'error_code', 'invalid_resolution_for_domain',
        'retryable', false
      );
    END IF;

    v_targets := v_targets || jsonb_build_array(
      jsonb_build_object(
        'entity_type', 'career_atom',
        'entity_id', v_atom_id::text,
        'entity_label', v_label,
        'already_registered', v_already_registered
      )
    );

    INSERT INTO public.career_skill_source_signals (
      user_id, career_atom_id, skill_key, skill_label,
      signal_type, signal_count, source_ref
    )
    VALUES (
      v_user,
      v_atom_id,
      v_key,
      v_label,
      CASE WHEN v_count > 0 THEN 'endorsement_count' ELSE 'self_reported_linkedin' END,
      v_count,
      'linkedin_import:' || (v_gate->>'import_id') || ':proposal:' || p_proposal_id::text
    )
    ON CONFLICT (user_id, skill_key, signal_type, source_system)
    DO UPDATE SET
      signal_count = excluded.signal_count,
      career_atom_id = coalesce(public.career_skill_source_signals.career_atom_id, excluded.career_atom_id),
      observed_at = now()
    RETURNING id INTO v_signal_id;

    v_targets := v_targets || jsonb_build_array(
      jsonb_build_object(
        'entity_type', 'career_skill_source_signal',
        'entity_id', v_signal_id::text,
        'entity_label', v_label
      )
    );

    v_event := public._linkedin_promotion_commit(
      v_gate,
      p_proposal_id,
      'promote_skill_or_signal',
      p_resolution,
      v_targets
    );
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error_code', 'already_promoted',
        'retryable', false
      );
    WHEN OTHERS THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error_code', 'promotion_write_failed',
        'retryable', true
      );
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'promotion_event_id', v_event,
    'status', 'promoted',
    'career_atom_id', v_atom_id,
    'signal_id', v_signal_id,
    'already_registered', v_already_registered
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.linkedin_promote_skill_or_signal(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.linkedin_promote_skill_or_signal(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.linkedin_promote_skill_or_signal(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.linkedin_promote_skill_or_signal(uuid, text, uuid) TO service_role;