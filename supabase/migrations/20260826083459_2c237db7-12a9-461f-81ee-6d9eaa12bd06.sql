-- 1) Utvid avstemmingsmotoren med søknader som observasjonskilde.
CREATE OR REPLACE FUNCTION public.network_company_reconciliation_scan(p_limit integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 300), 1), 1000);
  v_obs record;
  v_nname text;
  v_cands jsonb;
  v_count integer;
  v_state text;
  v_conf numeric;
  v_processed integer := 0;
  v_remaining integer := 0;
  v_global record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Ikke innlogget';
  END IF;

  FOR v_obs IN
    WITH observations AS (
      SELECT 'network_contact_company_relation'::text AS source_system,
             r.id::text AS source_record_id,
             COALESCE(NULLIF(btrim(r.company_name_observed), ''), NULLIF(btrim(r.company_name_canonical), '')) AS observed_name
      FROM public.network_contact_company_relations r
      WHERE r.user_id = v_user
        AND r.company_id IS NULL
      UNION ALL
      SELECT 'user_opportunity'::text,
             o.id::text,
             NULLIF(btrim(o.card_company), '')
      FROM public.user_opportunities o
      WHERE o.user_id = v_user
      UNION ALL
      SELECT 'application'::text,
             a.id::text,
             NULLIF(btrim(a.company_name), '')
      FROM public.applications a
      WHERE a.user_id = v_user
        AND a.company_id IS NULL
    )
    SELECT o.source_system,
           o.source_record_id,
           o.observed_name,
           o.source_system || ':' || o.source_record_id AS source_identity_key
    FROM observations o
    WHERE o.observed_name IS NOT NULL
      AND public.network_company_norm_name(o.observed_name) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.network_company_reconciliation x
        WHERE x.user_id = v_user
          AND x.superseded_at IS NULL
          AND x.source_identity_key = o.source_system || ':' || o.source_record_id
      )
    ORDER BY o.observed_name
    LIMIT v_limit
  LOOP
    v_nname := public.network_company_norm_name(v_obs.observed_name);

    SELECT * INTO v_global
    FROM public.source_company_resolutions g
    WHERE g.superseded_at IS NULL
      AND g.source_system = v_obs.source_system
      AND g.source_record_id = v_obs.source_record_id
    LIMIT 1;

    IF NOT FOUND AND v_obs.source_system = 'user_opportunity' THEN
      SELECT g.* INTO v_global
      FROM public.source_company_resolutions g
      JOIN public.user_opportunities uo ON uo.id = v_obs.source_record_id::uuid
      WHERE g.superseded_at IS NULL
        AND g.source_system = 'canonical_opportunity'
        AND uo.canonical_opportunity_id IS NOT NULL
        AND g.source_record_id = uo.canonical_opportunity_id::text
      LIMIT 1;
    END IF;

    IF FOUND THEN
      INSERT INTO public.network_company_reconciliation (
        user_id, source_system, source_record_id, source_identity_key,
        observed_name, normalized_name, company_id, orgnr, match_method,
        confidence, state, candidates, confirmed_at
      ) VALUES (
        v_user, v_obs.source_system, v_obs.source_record_id, v_obs.source_identity_key,
        v_obs.observed_name, v_nname, v_global.company_id, v_global.orgnr, 'source_orgnr',
        1.0, 'confirmed', '[]'::jsonb, now()
      )
      ON CONFLICT DO NOTHING;

      INSERT INTO public.user_company_relationships (user_id, company_id, company_name_user, relationship_kind, source_system)
      VALUES (v_user, v_global.company_id, v_obs.observed_name, 'unknown', v_obs.source_system)
      ON CONFLICT (user_id, company_id) DO NOTHING;

      IF v_obs.source_system = 'application' THEN
        UPDATE public.applications
        SET company_id = v_global.company_id, updated_at = now()
        WHERE id = v_obs.source_record_id::uuid AND user_id = v_user AND company_id IS NULL;
      END IF;

      v_processed := v_processed + 1;
      CONTINUE;
    END IF;

    SELECT jsonb_agg(c ORDER BY c->>'navn'), count(*)
      INTO v_cands, v_count
    FROM (
      SELECT jsonb_build_object(
               'orgnr', e.organisasjonsnummer,
               'navn', e.navn,
               'organisasjonsform', e.organisasjonsform_beskrivelse,
               'kommune', e.forretningsadresse_kommune,
               'antall_ansatte', e.antall_ansatte,
               'kilde', 'name_exact'
             ) AS c
      FROM reg.enheter e
      WHERE COALESCE(e.slettet, false) = false
        AND public.network_company_norm_name(e.navn) = v_nname
      LIMIT 20
    ) s;

    IF COALESCE(v_count, 0) = 1 THEN
      v_state := 'suggested_exact';
      v_conf := 0.92;
    ELSIF COALESCE(v_count, 0) > 1 THEN
      v_state := 'suggested_possible';
      v_conf := 0.6;
    ELSE
      SELECT jsonb_agg(c ORDER BY (c->>'score')::numeric DESC), count(*)
        INTO v_cands, v_count
      FROM (
        SELECT jsonb_build_object(
                 'orgnr', e.organisasjonsnummer,
                 'navn', e.navn,
                 'organisasjonsform', e.organisasjonsform_beskrivelse,
                 'kommune', e.forretningsadresse_kommune,
                 'antall_ansatte', e.antall_ansatte,
                 'score', round(similarity(e.navn, v_obs.observed_name)::numeric, 3),
                 'kilde', 'name_possible'
               ) AS c
        FROM reg.enheter e
        WHERE COALESCE(e.slettet, false) = false
          AND e.navn % v_obs.observed_name
          AND similarity(e.navn, v_obs.observed_name) >= 0.55
        ORDER BY similarity(e.navn, v_obs.observed_name) DESC
        LIMIT 10
      ) s;

      IF COALESCE(v_count, 0) > 0 THEN
        v_state := 'suggested_possible';
        v_conf := 0.4;
      ELSIF v_obs.observed_name ~* '(\m(inc|llc|ltd|limited|gmbh|plc|bv|b\.v\.|sarl|oy|ab|aps|a/s|corp|corporation)\M)' THEN
        v_state := 'foreign_unknown';
        v_conf := NULL;
        v_cands := '[]'::jsonb;
      ELSE
        v_state := 'not_found';
        v_conf := NULL;
        v_cands := '[]'::jsonb;
      END IF;
    END IF;

    INSERT INTO public.network_company_reconciliation (
      user_id, source_system, source_record_id, source_identity_key,
      observed_name, normalized_name, state, confidence, candidates
    ) VALUES (
      v_user, v_obs.source_system, v_obs.source_record_id, v_obs.source_identity_key,
      v_obs.observed_name, v_nname, v_state, v_conf, COALESCE(v_cands, '[]'::jsonb)
    )
    ON CONFLICT DO NOTHING;

    v_processed := v_processed + 1;
  END LOOP;

  SELECT count(*) INTO v_remaining
  FROM (
    SELECT r.id::text AS rid, 'network_contact_company_relation'::text AS ss,
           COALESCE(NULLIF(btrim(r.company_name_observed), ''), NULLIF(btrim(r.company_name_canonical), '')) AS nm
    FROM public.network_contact_company_relations r
    WHERE r.user_id = v_user AND r.company_id IS NULL
    UNION ALL
    SELECT o.id::text, 'user_opportunity'::text, NULLIF(btrim(o.card_company), '')
    FROM public.user_opportunities o
    WHERE o.user_id = v_user
    UNION ALL
    SELECT a.id::text, 'application'::text, NULLIF(btrim(a.company_name), '')
    FROM public.applications a
    WHERE a.user_id = v_user AND a.company_id IS NULL
  ) o
  WHERE o.nm IS NOT NULL
    AND public.network_company_norm_name(o.nm) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.network_company_reconciliation x
      WHERE x.user_id = v_user AND x.superseded_at IS NULL
        AND x.source_identity_key = o.ss || ':' || o.rid
    );

  RETURN jsonb_build_object('processed', v_processed, 'remaining', v_remaining);
END;
$function$;

REVOKE ALL ON FUNCTION public.network_company_reconciliation_scan(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_company_reconciliation_scan(integer) TO authenticated, service_role;

-- 2) Bekreftelse skal også sette selskapet på søknaden.
CREATE OR REPLACE FUNCTION public.network_company_reconciliation_confirm(p_reconciliation_id uuid, p_orgnr text, p_from_register_search boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row public.network_company_reconciliation%ROWTYPE;
  v_orgnr text := regexp_replace(COALESCE(p_orgnr, ''), '[^0-9]', '', 'g');
  v_in_candidates boolean;
  v_company_id uuid;
  v_method text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Ikke innlogget';
  END IF;

  SELECT * INTO v_row
  FROM public.network_company_reconciliation
  WHERE id = p_reconciliation_id AND user_id = v_user AND superseded_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_row.state = 'confirmed' THEN
    RETURN jsonb_build_object('status', 'already_confirmed', 'company_id', v_row.company_id, 'orgnr', v_row.orgnr);
  END IF;

  IF v_orgnr !~ '^[0-9]{9}$' THEN
    RETURN jsonb_build_object('status', 'invalid_orgnr');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM reg.enheter e
    WHERE e.organisasjonsnummer = v_orgnr AND COALESCE(e.slettet, false) = false
  ) THEN
    RETURN jsonb_build_object('status', 'not_in_register');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_row.candidates) c
    WHERE c->>'orgnr' = v_orgnr
  ) INTO v_in_candidates;

  IF v_in_candidates THEN
    v_method := CASE WHEN v_row.state = 'suggested_exact' THEN 'name_exact' ELSE 'name_possible' END;
  ELSIF COALESCE(p_from_register_search, false) THEN
    v_method := 'manual_search';
  ELSE
    RETURN jsonb_build_object('status', 'candidate_not_allowed');
  END IF;

  v_company_id := public.ensure_company_for_employer(v_orgnr);
  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('status', 'company_unavailable');
  END IF;

  UPDATE public.network_company_reconciliation
  SET company_id = v_company_id,
      orgnr = v_orgnr,
      match_method = v_method,
      state = 'confirmed',
      confidence = CASE WHEN v_method = 'name_exact' THEN 0.92 ELSE 0.75 END,
      confirmed_at = now(),
      rejected_at = NULL,
      updated_at = now()
  WHERE id = v_row.id;

  INSERT INTO public.user_company_relationships (user_id, company_id, company_name_user, relationship_kind, source_system)
  VALUES (v_user, v_company_id, v_row.observed_name, 'unknown', v_row.source_system)
  ON CONFLICT (user_id, company_id) DO NOTHING;

  IF v_row.source_system = 'application' THEN
    UPDATE public.applications
    SET company_id = v_company_id, updated_at = now()
    WHERE id = v_row.source_record_id::uuid AND user_id = v_user AND company_id IS NULL;
  END IF;

  RETURN jsonb_build_object('status', 'confirmed', 'company_id', v_company_id, 'orgnr', v_orgnr, 'match_method', v_method);
END;
$function$;

REVOKE ALL ON FUNCTION public.network_company_reconciliation_confirm(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_company_reconciliation_confirm(uuid, text, boolean) TO authenticated, service_role;

-- 3) Avstem ett enkelt selskapsnavn der og da.
CREATE OR REPLACE FUNCTION public.network_company_reconcile_one(
  p_source_system text,
  p_source_record_id text,
  p_observed_name text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_key text;
  v_nname text;
  v_row public.network_company_reconciliation%ROWTYPE;
  v_cands jsonb;
  v_count integer;
  v_state text;
  v_conf numeric;
  v_id uuid;
  v_company_id uuid;
  v_orgnr text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Ikke innlogget';
  END IF;
  IF p_source_system NOT IN ('application', 'user_opportunity') THEN
    RETURN jsonb_build_object('status', 'unsupported_source');
  END IF;

  v_nname := public.network_company_norm_name(COALESCE(p_observed_name, ''));
  IF v_nname IS NULL THEN
    RETURN jsonb_build_object('status', 'no_name');
  END IF;

  v_key := p_source_system || ':' || p_source_record_id;

  SELECT * INTO v_row
  FROM public.network_company_reconciliation
  WHERE user_id = v_user AND superseded_at IS NULL AND source_identity_key = v_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', v_row.state,
      'reconciliation_id', v_row.id,
      'observed_name', v_row.observed_name,
      'company_id', v_row.company_id,
      'orgnr', v_row.orgnr,
      'candidates', v_row.candidates
    );
  END IF;

  SELECT jsonb_agg(c ORDER BY c->>'navn'), count(*)
    INTO v_cands, v_count
  FROM (
    SELECT jsonb_build_object(
             'orgnr', e.organisasjonsnummer,
             'navn', e.navn,
             'organisasjonsform', e.organisasjonsform_beskrivelse,
             'kommune', e.forretningsadresse_kommune,
             'antall_ansatte', e.antall_ansatte,
             'kilde', 'name_exact'
           ) AS c
    FROM reg.enheter e
    WHERE COALESCE(e.slettet, false) = false
      AND public.network_company_norm_name(e.navn) = v_nname
    LIMIT 20
  ) s;

  IF COALESCE(v_count, 0) = 1 THEN
    v_state := 'suggested_exact';
    v_conf := 0.92;
  ELSIF COALESCE(v_count, 0) > 1 THEN
    v_state := 'suggested_possible';
    v_conf := 0.6;
  ELSE
    SELECT jsonb_agg(c ORDER BY (c->>'score')::numeric DESC), count(*)
      INTO v_cands, v_count
    FROM (
      SELECT jsonb_build_object(
               'orgnr', e.organisasjonsnummer,
               'navn', e.navn,
               'organisasjonsform', e.organisasjonsform_beskrivelse,
               'kommune', e.forretningsadresse_kommune,
               'antall_ansatte', e.antall_ansatte,
               'score', round(similarity(e.navn, p_observed_name)::numeric, 3),
               'kilde', 'name_possible'
             ) AS c
      FROM reg.enheter e
      WHERE COALESCE(e.slettet, false) = false
        AND e.navn % p_observed_name
        AND similarity(e.navn, p_observed_name) >= 0.55
      ORDER BY similarity(e.navn, p_observed_name) DESC
      LIMIT 10
    ) s;

    IF COALESCE(v_count, 0) > 0 THEN
      v_state := 'suggested_possible';
      v_conf := 0.4;
    ELSE
      v_state := 'not_found';
      v_conf := NULL;
      v_cands := '[]'::jsonb;
    END IF;
  END IF;

  INSERT INTO public.network_company_reconciliation (
    user_id, source_system, source_record_id, source_identity_key,
    observed_name, normalized_name, state, confidence, candidates
  ) VALUES (
    v_user, p_source_system, p_source_record_id, v_key,
    btrim(p_observed_name), v_nname, v_state, v_conf, COALESCE(v_cands, '[]'::jsonb)
  )
  RETURNING id INTO v_id;

  -- Entydig treff kobles automatisk; alt annet overlates til brukeren.
  IF v_state = 'suggested_exact' THEN
    v_orgnr := v_cands->0->>'orgnr';
    v_company_id := public.ensure_company_for_employer(v_orgnr);
    IF v_company_id IS NOT NULL THEN
      UPDATE public.network_company_reconciliation
      SET company_id = v_company_id, orgnr = v_orgnr, match_method = 'name_exact',
          state = 'confirmed', confirmed_at = now(), updated_at = now()
      WHERE id = v_id;

      INSERT INTO public.user_company_relationships (user_id, company_id, company_name_user, relationship_kind, source_system)
      VALUES (v_user, v_company_id, btrim(p_observed_name), 'unknown', p_source_system)
      ON CONFLICT (user_id, company_id) DO NOTHING;

      IF p_source_system = 'application' THEN
        UPDATE public.applications
        SET company_id = v_company_id, updated_at = now()
        WHERE id = p_source_record_id::uuid AND user_id = v_user AND company_id IS NULL;
      END IF;

      RETURN jsonb_build_object(
        'status', 'confirmed', 'reconciliation_id', v_id,
        'observed_name', btrim(p_observed_name),
        'company_id', v_company_id, 'orgnr', v_orgnr, 'candidates', v_cands
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', v_state, 'reconciliation_id', v_id,
    'observed_name', btrim(p_observed_name),
    'company_id', NULL, 'orgnr', NULL,
    'candidates', COALESCE(v_cands, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.network_company_reconcile_one(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_company_reconcile_one(text, text, text) TO authenticated, service_role;

-- 4) Flytt et jobb-lead til Muligheter.
CREATE OR REPLACE FUNCTION public.job_lead_promote_to_opportunity(p_job_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_lead public.job_leads%ROWTYPE;
  v_fp text;
  v_url text;
  v_canon uuid;
  v_opp uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Ikke innlogget';
  END IF;

  SELECT * INTO v_lead FROM public.job_leads WHERE id = p_job_lead_id AND user_id = v_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  v_fp := public.opportunity_fingerprint(COALESCE(v_lead.company, ''), COALESCE(v_lead.title, ''), COALESCE(v_lead.location, ''));
  v_url := COALESCE(NULLIF(btrim(v_lead.job_url), ''), 'lead:' || v_lead.id::text);

  SELECT id INTO v_canon FROM public.canonical_opportunities WHERE identity_fingerprint = v_fp LIMIT 1;
  IF v_canon IS NULL THEN
    INSERT INTO public.canonical_opportunities (
      identity_fingerprint, display_title, display_company, display_location, display_url, primary_source
    ) VALUES (
      v_fp, v_lead.title, v_lead.company, v_lead.location, v_url,
      COALESCE(NULLIF(v_lead.source_system, ''), 'job_lead')
    )
    RETURNING id INTO v_canon;
  END IF;

  INSERT INTO public.user_opportunities (
    user_id, canonical_opportunity_id, identity_fingerprint, status,
    card_title, card_company, card_location, card_salary,
    card_display_url, card_raw_url, card_published_at, card_source,
    ai_score, ai_reasoning, ai_match_highlights, ai_concerns, ai_scored_at,
    relevance_score, screening_status, screening_reasons, requirement_summary,
    match_score_version, match_scored_model, screening_evaluated_at
  ) VALUES (
    v_user, v_canon, v_fp, 'saved',
    v_lead.title, v_lead.company, v_lead.location, v_lead.salary_text,
    v_url, v_url, v_lead.received_at, COALESCE(NULLIF(v_lead.source_system, ''), 'job_lead'),
    v_lead.ai_score, v_lead.ai_reasoning, v_lead.ai_match_highlights, v_lead.ai_concerns, v_lead.ai_scored_at,
    v_lead.ai_score, v_lead.screening_status, COALESCE(v_lead.screening_reasons, '[]'::jsonb),
    COALESCE(v_lead.requirement_summary, '{}'::jsonb),
    v_lead.match_score_version, v_lead.match_scored_model, v_lead.screening_evaluated_at
  )
  ON CONFLICT (user_id, canonical_opportunity_id) DO UPDATE
    SET status = 'saved', updated_at = now()
  RETURNING id INTO v_opp;

  DELETE FROM public.job_leads WHERE id = v_lead.id AND user_id = v_user;

  RETURN jsonb_build_object(
    'status', 'promoted',
    'opportunity_id', v_opp,
    'company', v_lead.company,
    'title', v_lead.title
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.job_lead_promote_to_opportunity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_lead_promote_to_opportunity(uuid) TO authenticated, service_role;