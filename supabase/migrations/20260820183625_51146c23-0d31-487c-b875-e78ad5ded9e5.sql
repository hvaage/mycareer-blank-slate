-- Fase 4: domenespesifikke promoterings-RPC-er

-- 1) Profilfelt --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.linkedin_promote_profile_field(
  p_proposal_id uuid,
  p_resolution text,
  p_field text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_gate jsonb;
  v_user uuid;
  v_payload jsonb;
  v_value text;
  v_current text;
  v_event uuid;
  v_col text;
BEGIN
  v_gate := public._linkedin_promotion_gate(p_proposal_id, p_resolution, ARRAY['profile']);
  IF NOT (v_gate->>'ok')::boolean THEN RETURN v_gate; END IF;
  v_user := (v_gate->>'user_id')::uuid;
  v_payload := v_gate->'payload';

  IF p_field NOT IN ('headline','summary','location','industry','public_profile_url','languages') THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'field_not_promotable', 'retryable', false);
  END IF;

  v_value := nullif(btrim(coalesce(v_payload->>'value', v_payload->>p_field, '')), '');
  IF v_value IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'empty_source_value', 'retryable', false);
  END IF;

  BEGIN
    IF p_field IN ('industry','languages') THEN
      -- tekstlister: additiv, aldri overskriving
      IF p_field = 'industry' THEN
        UPDATE public.profiles
        SET industries = (SELECT array_agg(DISTINCT x) FROM unnest(coalesce(industries, ARRAY[]::text[]) || ARRAY[v_value]) AS x),
            updated_at = now()
        WHERE id = v_user;
      ELSE
        UPDATE public.profiles
        SET languages = (SELECT array_agg(DISTINCT x) FROM unnest(coalesce(languages, ARRAY[]::text[]) || ARRAY[v_value]) AS x),
            updated_at = now()
        WHERE id = v_user;
      END IF;
    ELSE
      v_col := CASE p_field
        WHEN 'headline' THEN 'headline'
        WHEN 'summary' THEN 'bio'
        WHEN 'location' THEN 'target_city'
        WHEN 'public_profile_url' THEN 'linkedin_vanity_url'
      END;

      EXECUTE format('SELECT nullif(btrim(coalesce(%I::text, '''')), '''') FROM public.profiles WHERE id = $1', v_col)
        INTO v_current USING v_user;

      IF v_current IS NOT NULL AND v_current = v_value THEN
        RETURN jsonb_build_object('ok', false, 'error_code', 'no_change_needed', 'retryable', false);
      END IF;

      IF v_current IS NOT NULL AND p_resolution <> 'use_linkedin_value' THEN
        RETURN jsonb_build_object('ok', false, 'error_code', 'target_not_empty', 'retryable', false,
          'conflict', jsonb_build_object('field', p_field, 'current', v_current, 'linkedin', v_value));
      END IF;

      EXECUTE format('UPDATE public.profiles SET %I = $1, updated_at = now() WHERE id = $2', v_col)
        USING v_value, v_user;
    END IF;

    v_event := public._linkedin_promotion_commit(
      v_gate, p_proposal_id, 'promote_profile_field', p_resolution,
      jsonb_build_array(jsonb_build_object('entity_type','profile_field','entity_id',p_field,'entity_label',p_field)),
      'md5:' || md5(v_value)
    );
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'already_promoted', 'retryable', false);
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'promotion_write_failed', 'retryable', true);
  END;

  RETURN jsonb_build_object('ok', true, 'promotion_event_id', v_event, 'status', 'promoted', 'field', p_field);
END;
$$;

-- 2) Karriere ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.linkedin_promote_career_record(
  p_proposal_id uuid,
  p_resolution text,
  p_existing_atom_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_gate jsonb;
  v_user uuid;
  v_payload jsonb;
  v_atom_id uuid;
  v_event uuid;
  v_title text;
  v_company text;
  v_src text;
BEGIN
  v_gate := public._linkedin_promotion_gate(p_proposal_id, p_resolution, ARRAY['career']);
  IF NOT (v_gate->>'ok')::boolean THEN RETURN v_gate; END IF;
  v_user := (v_gate->>'user_id')::uuid;
  v_payload := v_gate->'payload';
  v_title := nullif(btrim(coalesce(v_payload->>'title','')), '');
  v_company := nullif(btrim(coalesce(v_payload->>'company','')), '');
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
      IF v_title IS NULL AND v_company IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error_code', 'empty_source_value', 'retryable', false);
      END IF;

      INSERT INTO public.career_atoms (
        user_id, atom_kind, atom_type, content_no, structured_data,
        source_type, source_ref, confidence, user_confirmed
      )
      VALUES (
        v_user, 'evidens', 'role',
        btrim(coalesce(v_title,'') || CASE WHEN v_company IS NOT NULL THEN ' · ' || v_company ELSE '' END),
        v_payload, 'linkedin_export', v_src, 'imported', false
      )
      RETURNING id INTO v_atom_id;
    ELSE
      RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_resolution_for_domain', 'retryable', false);
    END IF;

    v_event := public._linkedin_promotion_commit(
      v_gate, p_proposal_id, 'promote_career_record', p_resolution,
      jsonb_build_array(jsonb_build_object('entity_type','career_atom','entity_id',v_atom_id::text,'entity_label',v_title))
    );
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'already_promoted', 'retryable', false);
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'promotion_write_failed', 'retryable', true);
  END;

  RETURN jsonb_build_object('ok', true, 'promotion_event_id', v_event, 'status', 'promoted', 'career_atom_id', v_atom_id);
END;
$$;

-- 3) Kvalifikasjon -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.linkedin_promote_qualification(
  p_proposal_id uuid,
  p_resolution text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  v_type := coalesce(v_payload->>'atom_type', v_payload->>'qualification_kind', 'certification');
  v_label := nullif(btrim(coalesce(v_payload->>'title', v_payload->>'name', '')), '');

  IF v_type NOT IN ('education','certification','language') THEN
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
$$;

-- 4) Kompetanse / signal -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.linkedin_promote_skill_or_signal(
  p_proposal_id uuid,
  p_resolution text,
  p_existing_atom_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
BEGIN
  v_gate := public._linkedin_promotion_gate(p_proposal_id, p_resolution, ARRAY['profile','career','endorsements']);
  IF NOT (v_gate->>'ok')::boolean THEN RETURN v_gate; END IF;
  v_user := (v_gate->>'user_id')::uuid;
  v_payload := v_gate->'payload';
  v_label := nullif(btrim(coalesce(v_payload->>'skill', v_payload->>'title', v_payload->>'name', '')), '');
  IF v_label IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'empty_source_value', 'retryable', false);
  END IF;
  v_key := lower(regexp_replace(v_label, '\s+', ' ', 'g'));
  v_count := coalesce((v_payload->>'endorsement_count')::integer, 0);

  BEGIN
    IF p_resolution = 'create_new' THEN
      INSERT INTO public.career_atoms (
        user_id, atom_kind, atom_type, content_no, structured_data,
        source_type, source_ref, confidence, user_confirmed
      )
      VALUES (
        v_user, 'evidens', 'skill', v_label,
        v_payload || jsonb_build_object('self_reported_linkedin', true),
        'linkedin_export',
        'linkedin_import:' || (v_gate->>'import_id') || ':proposal:' || p_proposal_id::text,
        'imported', false
      )
      RETURNING id INTO v_atom_id;
    ELSIF p_resolution = 'link_to_existing' THEN
      SELECT id INTO v_atom_id FROM public.career_atoms
      WHERE id = p_existing_atom_id AND user_id = v_user AND is_active AND atom_type = 'skill';
      IF v_atom_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error_code', 'existing_target_not_found', 'retryable', false);
      END IF;
    ELSE
      RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_resolution_for_domain', 'retryable', false);
    END IF;

    IF v_atom_id IS NOT NULL THEN
      v_targets := v_targets || jsonb_build_array(
        jsonb_build_object('entity_type','career_atom','entity_id',v_atom_id::text,'entity_label',v_label));
    END IF;

    INSERT INTO public.career_skill_source_signals (
      user_id, career_atom_id, skill_key, skill_label, signal_type, signal_count, source_ref
    )
    VALUES (
      v_user, v_atom_id, v_key, v_label,
      CASE WHEN v_count > 0 THEN 'endorsement_count' ELSE 'self_reported_linkedin' END,
      v_count,
      'linkedin_import:' || (v_gate->>'import_id') || ':proposal:' || p_proposal_id::text
    )
    ON CONFLICT (user_id, skill_key, signal_type, source_system)
    DO UPDATE SET signal_count = excluded.signal_count,
                  career_atom_id = coalesce(public.career_skill_source_signals.career_atom_id, excluded.career_atom_id),
                  observed_at = now()
    RETURNING id INTO v_signal_id;

    v_targets := v_targets || jsonb_build_array(
      jsonb_build_object('entity_type','career_skill_source_signal','entity_id',v_signal_id::text,'entity_label',v_label));

    v_event := public._linkedin_promotion_commit(
      v_gate, p_proposal_id, 'promote_skill_or_signal', p_resolution, v_targets);
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'already_promoted', 'retryable', false);
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'promotion_write_failed', 'retryable', true);
  END;

  RETURN jsonb_build_object('ok', true, 'promotion_event_id', v_event, 'status', 'promoted',
                            'career_atom_id', v_atom_id, 'signal_id', v_signal_id);
END;
$$;

-- 5) Anbefaling --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.linkedin_promote_recommendation(
  p_proposal_id uuid,
  p_resolution text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_gate jsonb;
  v_user uuid;
  v_payload jsonb;
  v_text text;
  v_author text;
  v_author_key text;
  v_id uuid;
  v_event uuid;
BEGIN
  v_gate := public._linkedin_promotion_gate(p_proposal_id, p_resolution, ARRAY['recommendations']);
  IF NOT (v_gate->>'ok')::boolean THEN RETURN v_gate; END IF;
  v_user := (v_gate->>'user_id')::uuid;
  v_payload := v_gate->'payload';
  v_text := nullif(btrim(coalesce(v_payload->>'text', v_payload->>'recommendation_text', '')), '');
  v_author := nullif(btrim(coalesce(v_payload->>'author_name', v_payload->>'first_name' || ' ' || coalesce(v_payload->>'last_name',''), '')), '');
  v_author_key := lower(coalesce(nullif(btrim(coalesce(v_payload->>'author_profile_url','')), ''), coalesce(v_author,'ukjent')));

  IF v_text IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'empty_source_value', 'retryable', false);
  END IF;
  IF p_resolution <> 'create_new' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_resolution_for_domain', 'retryable', false);
  END IF;

  BEGIN
    INSERT INTO public.career_recommendations (
      user_id, author_name, author_identity_key, author_title, author_company,
      relationship_text, recommendation_text, text_hash, recommended_on, source_ref
    )
    VALUES (
      v_user, v_author, v_author_key, v_payload->>'author_title', v_payload->>'author_company',
      v_payload->>'relationship', v_text, md5(v_text),
      nullif(v_payload->>'recommended_on','')::date,
      'linkedin_import:' || (v_gate->>'import_id') || ':proposal:' || p_proposal_id::text
    )
    ON CONFLICT (user_id, author_identity_key, text_hash) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_id;

    v_event := public._linkedin_promotion_commit(
      v_gate, p_proposal_id, 'promote_recommendation', p_resolution,
      jsonb_build_array(jsonb_build_object('entity_type','career_recommendation','entity_id',v_id::text,'entity_label',v_author)));
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'already_promoted', 'retryable', false);
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'promotion_write_failed', 'retryable', true);
  END;

  RETURN jsonb_build_object('ok', true, 'promotion_event_id', v_event, 'status', 'promoted', 'recommendation_id', v_id);
END;
$$;

-- 6) Nettverkskontakt --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.linkedin_promote_network_contact(
  p_proposal_id uuid,
  p_resolution text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_gate jsonb;
  v_user uuid;
  v_payload jsonb;
  v_name text;
  v_url text;
  v_id uuid;
  v_event uuid;
BEGIN
  v_gate := public._linkedin_promotion_gate(p_proposal_id, p_resolution, ARRAY['network']);
  IF NOT (v_gate->>'ok')::boolean THEN RETURN v_gate; END IF;
  v_user := (v_gate->>'user_id')::uuid;
  v_payload := v_gate->'payload';
  v_name := nullif(btrim(coalesce(v_payload->>'display_name',
              btrim(coalesce(v_payload->>'first_name','') || ' ' || coalesce(v_payload->>'last_name','')))), '');
  v_url := lower(nullif(btrim(coalesce(v_payload->>'profile_url', v_payload->>'linkedin_url', '')), ''));

  IF v_url IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'missing_identity', 'retryable', false);
  END IF;
  IF p_resolution <> 'create_new' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_resolution_for_domain', 'retryable', false);
  END IF;

  BEGIN
    SELECT c.id INTO v_id
    FROM public.network_contact_identities i
    JOIN public.network_contacts c ON c.id = i.network_contact_id AND c.user_id = i.user_id
    WHERE i.user_id = v_user AND i.identity_kind = 'linkedin_profile_url' AND i.identity_key = v_url;

    IF v_id IS NULL THEN
      INSERT INTO public.network_contacts (user_id, display_name, headline, company, connected_on, source_ref)
      VALUES (v_user, v_name, v_payload->>'headline', v_payload->>'company',
              nullif(v_payload->>'connected_on','')::date,
              'linkedin_import:' || (v_gate->>'import_id') || ':proposal:' || p_proposal_id::text)
      RETURNING id INTO v_id;

      INSERT INTO public.network_contact_identities (user_id, network_contact_id, identity_kind, identity_key)
      VALUES (v_user, v_id, 'linkedin_profile_url', v_url)
      ON CONFLICT (user_id, identity_kind, identity_key) DO NOTHING;
    END IF;

    v_event := public._linkedin_promotion_commit(
      v_gate, p_proposal_id, 'promote_network_contact', p_resolution,
      jsonb_build_array(jsonb_build_object('entity_type','network_contact','entity_id',v_id::text,'entity_label',v_name)));
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'already_promoted', 'retryable', false);
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'promotion_write_failed', 'retryable', true);
  END;

  RETURN jsonb_build_object('ok', true, 'promotion_event_id', v_event, 'status', 'promoted', 'network_contact_id', v_id);
END;
$$;

-- 7) Jobbønske ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.linkedin_promote_job_preference(
  p_proposal_id uuid,
  p_resolution text,
  p_field text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_gate jsonb;
  v_user uuid;
  v_payload jsonb;
  v_value text;
  v_current text;
  v_event uuid;
BEGIN
  v_gate := public._linkedin_promotion_gate(p_proposal_id, p_resolution, ARRAY['jobs']);
  IF NOT (v_gate->>'ok')::boolean THEN RETURN v_gate; END IF;
  v_user := (v_gate->>'user_id')::uuid;
  v_payload := v_gate->'payload';
  v_value := nullif(btrim(coalesce(v_payload->>'value', v_payload->>p_field, '')), '');

  IF p_field NOT IN ('desired_role_types','desired_industries','preferred_locations','remote_preference','travel_preference') THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'field_not_promotable', 'retryable', false);
  END IF;
  IF v_value IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'empty_source_value', 'retryable', false);
  END IF;

  BEGIN
    INSERT INTO public.user_career_profiles (user_id) VALUES (v_user)
    ON CONFLICT (user_id) DO NOTHING;

    IF p_field IN ('desired_role_types','desired_industries','preferred_locations') THEN
      EXECUTE format(
        'UPDATE public.user_career_profiles SET %I = (SELECT array_agg(DISTINCT x) FROM unnest(coalesce(%I, ARRAY[]::text[]) || ARRAY[$1]) AS x), updated_at = now() WHERE user_id = $2',
        p_field, p_field) USING v_value, v_user;
    ELSE
      EXECUTE format('SELECT nullif(btrim(coalesce(%I, '''')), '''') FROM public.user_career_profiles WHERE user_id = $1', p_field)
        INTO v_current USING v_user;

      IF v_current IS NOT NULL AND v_current = v_value THEN
        RETURN jsonb_build_object('ok', false, 'error_code', 'no_change_needed', 'retryable', false);
      END IF;
      IF v_current IS NOT NULL AND p_resolution <> 'use_linkedin_value' THEN
        RETURN jsonb_build_object('ok', false, 'error_code', 'target_not_empty', 'retryable', false,
          'conflict', jsonb_build_object('field', p_field, 'current', v_current, 'linkedin', v_value));
      END IF;

      EXECUTE format('UPDATE public.user_career_profiles SET %I = $1, updated_at = now() WHERE user_id = $2', p_field)
        USING v_value, v_user;
    END IF;

    v_event := public._linkedin_promotion_commit(
      v_gate, p_proposal_id, 'promote_job_preference', p_resolution,
      jsonb_build_array(jsonb_build_object('entity_type','user_career_profile_field','entity_id',p_field,'entity_label',p_field)),
      'md5:' || md5(v_value));
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'already_promoted', 'retryable', false);
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'promotion_write_failed', 'retryable', true);
  END;

  RETURN jsonb_build_object('ok', true, 'promotion_event_id', v_event, 'status', 'promoted', 'field', p_field);
END;
$$;

-- 8) Lagret jobb -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.linkedin_promote_saved_job(
  p_proposal_id uuid,
  p_resolution text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_gate jsonb;
  v_user uuid;
  v_payload jsonb;
  v_title text;
  v_url text;
  v_hash text;
  v_id uuid;
  v_event uuid;
BEGIN
  v_gate := public._linkedin_promotion_gate(p_proposal_id, p_resolution, ARRAY['jobs']);
  IF NOT (v_gate->>'ok')::boolean THEN RETURN v_gate; END IF;
  v_user := (v_gate->>'user_id')::uuid;
  v_payload := v_gate->'payload';
  v_title := nullif(btrim(coalesce(v_payload->>'title','')), '');
  v_url := nullif(btrim(coalesce(v_payload->>'job_url', v_payload->>'url', '')), '');

  IF v_title IS NULL AND v_url IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'empty_source_value', 'retryable', false);
  END IF;
  IF p_resolution <> 'create_new' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_resolution_for_domain', 'retryable', false);
  END IF;
  v_hash := md5(coalesce(v_url, v_title));

  BEGIN
    SELECT id INTO v_id FROM public.job_leads
    WHERE user_id = v_user AND source_system = 'linkedin_export' AND source_url_hash = v_hash;

    IF v_id IS NULL THEN
      INSERT INTO public.job_leads (
        user_id, title, company, location, job_url, status,
        source_system, source_url_hash, source_observed_at
      )
      VALUES (
        v_user, v_title, v_payload->>'company', v_payload->>'location', v_url, 'ny',
        'linkedin_export', v_hash, coalesce(nullif(v_payload->>'saved_at','')::timestamptz, now())
      )
      RETURNING id INTO v_id;
    END IF;

    v_event := public._linkedin_promotion_commit(
      v_gate, p_proposal_id, 'promote_saved_job', p_resolution,
      jsonb_build_array(jsonb_build_object('entity_type','job_lead','entity_id',v_id::text,'entity_label',v_title)));
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'already_promoted', 'retryable', false);
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'promotion_write_failed', 'retryable', true);
  END;

  RETURN jsonb_build_object('ok', true, 'promotion_event_id', v_event, 'status', 'promoted', 'job_lead_id', v_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.linkedin_promote_profile_field(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.linkedin_promote_career_record(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.linkedin_promote_qualification(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.linkedin_promote_skill_or_signal(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.linkedin_promote_recommendation(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.linkedin_promote_network_contact(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.linkedin_promote_job_preference(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.linkedin_promote_saved_job(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.linkedin_promote_profile_field(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.linkedin_promote_career_record(uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.linkedin_promote_qualification(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.linkedin_promote_skill_or_signal(uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.linkedin_promote_recommendation(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.linkedin_promote_network_contact(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.linkedin_promote_job_preference(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.linkedin_promote_saved_job(uuid, text) TO authenticated, service_role;