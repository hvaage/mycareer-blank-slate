-- Employer analysis report completeness: private candidate scenarios and
-- automatic target-atom reconciliation whenever canonical analysis changes.

ALTER TABLE public.user_company_ratings
  ADD COLUMN IF NOT EXISTS ai_candidate_scenario_notes jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_company_ratings_candidate_scenarios_array_chk'
      AND conrelid = 'public.user_company_ratings'::regclass
  ) THEN
    ALTER TABLE public.user_company_ratings
      ADD CONSTRAINT user_company_ratings_candidate_scenarios_array_chk
      CHECK (jsonb_typeof(ai_candidate_scenario_notes) = 'array');
  END IF;
END
$$;

COMMENT ON COLUMN public.user_company_ratings.ai_candidate_scenario_notes IS
  'Private, user-scoped scenario notes generated from the candidate profile and canonical employer analysis.';

CREATE OR REPLACE FUNCTION public._employer_analysis_public_projection(p_analysis jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_analysis IS NULL OR jsonb_typeof(p_analysis) <> 'object' THEN p_analysis
    ELSE jsonb_set(
      p_analysis,
      '{sources}',
      coalesce((
        SELECT jsonb_agg(source_item.value ORDER BY source_item.ordinality)
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(p_analysis -> 'sources') = 'array'
            THEN p_analysis -> 'sources' ELSE '[]'::jsonb END
        )
          WITH ORDINALITY AS source_item(value, ordinality)
        WHERE coalesce(source_item.value ->> 'category', 'other')
          NOT IN ('employee_reviews', 'salary_benchmark')
          AND lower(coalesce(source_item.value ->> 'url', '')) !~
            '(^|[./])(glassdoor|jobbi|indeed|kununu|trustpilot|levels[.]fyi|comparably|ambitionbox|greatplacetowork)([./]|$)'
      ), '[]'::jsonb),
      true
    )
  END;
$$;

REVOKE ALL ON FUNCTION public._employer_analysis_public_projection(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._employer_analysis_public_projection(jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_employer_analysis_view(
  p_organisasjonsnummer text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, reg, pg_temp
AS $$
DECLARE
  v_orgnr text := regexp_replace(coalesce(p_organisasjonsnummer, ''), '\D', '', 'g');
  v_uid uuid := auth.uid();
  v_company public.companies%ROWTYPE;
  v_analysis jsonb;
  v_register jsonb;
  v_admin public.employer_analysis_weight_profiles%ROWTYPE;
  v_user public.user_employer_analysis_weights%ROWTYPE;
  v_employer_weights jsonb;
  v_ai_weights jsonb;
  v_is_customized boolean := false;
BEGIN
  IF v_orgnr !~ '^[0-9]{9}$' THEN
    RAISE EXCEPTION 'invalid_organisasjonsnummer' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_company
  FROM public.companies
  WHERE organisasjonsnummer = v_orgnr
  LIMIT 1;

  v_analysis := public._employer_analysis_public_projection(v_company.employer_analysis_v2);
  v_register := public.get_employer_analysis_context(v_orgnr);

  SELECT * INTO v_admin
  FROM public.employer_analysis_weight_profiles
  WHERE profile_key = 'public_default' AND is_active
  ORDER BY version DESC
  LIMIT 1;

  v_employer_weights := coalesce(
    v_admin.employer_weights,
    public._employer_analysis_default_weights('employer')
  );
  v_ai_weights := coalesce(
    v_admin.ai_weights,
    public._employer_analysis_default_weights('ai')
  );

  IF v_uid IS NOT NULL THEN
    SELECT * INTO v_user
    FROM public.user_employer_analysis_weights
    WHERE user_id = v_uid;
    IF FOUND THEN
      v_is_customized := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'organisasjonsnummer', v_orgnr,
    'company', jsonb_strip_nulls(jsonb_build_object(
      'id', v_company.id,
      'name', coalesce(v_company.name, v_register #>> '{entity,legal_name}'),
      'domain', v_company.domain,
      'industry', coalesce(v_company.industry, v_register #>> '{entity,industry_primary}'),
      'analysis_version', v_company.employer_analysis_version,
      'analysis_rated_at', v_company.employer_analysis_rated_at,
      'analysis_source_updated_at', v_company.employer_analysis_source_updated_at
    )),
    'register', v_register,
    'financials', v_company.financials,
    'analysis', v_analysis,
    'weighting', jsonb_build_object(
      'admin_profile', jsonb_build_object(
        'version', coalesce(v_admin.version, 1),
        'employer_weights', v_employer_weights,
        'ai_weights', v_ai_weights
      ),
      'public', jsonb_build_object(
        'employer', public._employer_analysis_weighted_score(
          v_analysis, v_employer_weights, 'employer'
        ),
        'ai', public._employer_analysis_weighted_score(
          v_analysis, v_ai_weights, 'ai'
        )
      ),
      'personal', CASE WHEN v_uid IS NULL THEN NULL ELSE jsonb_build_object(
        'is_customized', v_is_customized,
        'employer_weights', coalesce(v_user.employer_weights, v_employer_weights),
        'ai_weights', coalesce(v_user.ai_weights, v_ai_weights),
        'employer', public._employer_analysis_weighted_score(
          v_analysis,
          coalesce(v_user.employer_weights, v_employer_weights),
          'employer'
        ),
        'ai', public._employer_analysis_weighted_score(
          v_analysis,
          coalesce(v_user.ai_weights, v_ai_weights),
          'ai'
        )
      ) END
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_employer_analysis_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_employer_analysis_view(text)
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_employer_analysis_view(text) IS
  'Canonical public/authenticated employer-analysis read model with safe public sources. Authenticated users additionally receive their own weighted totals.';

CREATE OR REPLACE FUNCTION public._refresh_company_analysis_atoms(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_analysis jsonb;
  v_item jsonb;
  v_key text;
  v_label text;
  v_category text;
  v_hash text;
  v_score numeric;
  v_strength integer;
  v_status text;
  v_now timestamptz := clock_timestamp();
  v_profile_hashes text[] := ARRAY[]::text[];
  v_signal_hashes text[] := ARRAY[]::text[];
  v_signals jsonb := '[]'::jsonb;
  v_profile_upserted integer := 0;
  v_signal_upserted integer := 0;
  v_deactivated integer := 0;
  v_signal_deactivated integer := 0;
BEGIN
  SELECT c.employer_analysis_v2
    INTO v_analysis
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'company_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_analysis IS NULL OR jsonb_typeof(v_analysis) <> 'object' THEN
    RETURN jsonb_build_object(
      'profile_upserted', 0,
      'signal_upserted', 0,
      'deactivated', 0
    );
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(v_analysis -> 'dimensions') = 'array'
        THEN v_analysis -> 'dimensions' ELSE '[]'::jsonb END
    )
  LOOP
    v_key := v_item ->> 'key';
    v_status := coalesce(v_item ->> 'evidence_status', 'insufficient_evidence');
    IF v_key IS NULL OR NOT (v_key = ANY(ARRAY[
      'culture', 'leadership', 'work_environment', 'career_development',
      'financial_stability', 'mission', 'talent_attraction_retention',
      'diversity_inclusion'
    ]::text[])) OR jsonb_typeof(v_item -> 'score') <> 'number'
      OR v_status NOT IN ('sourced', 'inferred') THEN
      CONTINUE;
    END IF;

    v_score := (v_item ->> 'score')::numeric;
    v_strength := greatest(1, least(5, round(v_score)::integer));
    v_label := CASE v_key
      WHEN 'culture' THEN 'Kultur og verdier'
      WHEN 'leadership' THEN 'Ledelseskvalitet'
      WHEN 'work_environment' THEN 'Arbeidsmiljø'
      WHEN 'career_development' THEN 'Karriereutvikling'
      WHEN 'financial_stability' THEN 'Finansiell stabilitet'
      WHEN 'mission' THEN 'Misjon og formål'
      WHEN 'talent_attraction_retention' THEN 'Rekruttering og retensjon'
      WHEN 'diversity_inclusion' THEN 'Mangfold og inkludering'
    END;
    v_category := CASE v_key
      WHEN 'culture' THEN 'culture_strength'
      WHEN 'financial_stability' THEN 'financial_stability'
      WHEN 'mission' THEN 'mission_driven'
      ELSE v_key
    END;
    v_hash := encode(extensions.digest(
      'employer_analysis:' || p_company_id::text || ':dimension:' || v_key,
      'sha256'
    ), 'hex');
    v_profile_hashes := array_append(v_profile_hashes, v_hash);

    UPDATE public.company_profile_atoms
    SET category = v_category,
        dimension = v_key,
        label = v_label,
        normalized_value = v_score::text,
        description = nullif(v_item ->> 'rationale', ''),
        strength_score = v_strength,
        confidence_score = CASE WHEN v_status = 'sourced' THEN 0.9 ELSE 0.7 END,
        inferred = v_status = 'inferred',
        is_active = true,
        refreshed_at = v_now,
        stale_at = NULL
    WHERE company_id = p_company_id
      AND source = 'employer_analysis'
      AND source_hash = v_hash;

    IF NOT FOUND THEN
      INSERT INTO public.company_profile_atoms (
        company_id, category, dimension, label, normalized_value, description,
        strength_score, confidence_score, source, source_hash, inferred,
        is_active, refreshed_at, stale_at
      ) VALUES (
        p_company_id, v_category, v_key, v_label, v_score::text,
        nullif(v_item ->> 'rationale', ''), v_strength,
        CASE WHEN v_status = 'sourced' THEN 0.9 ELSE 0.7 END,
        'employer_analysis', v_hash, v_status = 'inferred', true, v_now, NULL
      );
    END IF;
    v_profile_upserted := v_profile_upserted + 1;
  END LOOP;

  IF coalesce(v_analysis #>> '{ai_maturity,applicable}', 'true') = 'true'
     AND jsonb_typeof(v_analysis #> '{ai_maturity,score}') = 'number' THEN
    v_signals := v_signals || jsonb_build_array(jsonb_build_object(
      'type', 'ai_initiative',
      'label', 'AI-modenhet',
      'description', v_analysis #>> '{ai_maturity,narrative}',
      'strength', greatest(1, least(5, round((v_analysis #>> '{ai_maturity,score}')::numeric)::integer)),
      'confidence', 0.85
    ));
  END IF;

  IF coalesce(v_analysis #>> '{supplemental_insights,esg_and_regulatory,evidence_status}', '')
     IN ('sourced', 'inferred') THEN
    v_signals := v_signals || jsonb_build_array(jsonb_build_object(
      'type', 'sustainability_push',
      'label', 'ESG og regulatorisk profil',
      'description', v_analysis #>> '{supplemental_insights,esg_and_regulatory,narrative}',
      'strength', 4,
      'confidence', 0.8
    ));
  END IF;

  IF coalesce(v_analysis #>> '{supplemental_insights,employee_sentiment_trend,evidence_status}', '')
     IN ('sourced', 'inferred') THEN
    v_signals := v_signals || jsonb_build_array(jsonb_build_object(
      'type', 'employee_sentiment',
      'label', 'Trend i ansattomtaler',
      'description', v_analysis #>> '{supplemental_insights,employee_sentiment_trend,narrative}',
      'strength', CASE v_analysis #>> '{supplemental_insights,employee_sentiment_trend,direction}'
        WHEN 'improving' THEN 4 WHEN 'declining' THEN 2 ELSE 3 END,
      'confidence', 0.75
    ));
  END IF;

  IF coalesce(v_analysis #>> '{supplemental_insights,compensation_signals,evidence_status}', '')
     IN ('sourced', 'inferred') THEN
    v_signals := v_signals || jsonb_build_array(jsonb_build_object(
      'type', 'compensation_signal',
      'label', 'Lønnssignaler',
      'description', v_analysis #>> '{supplemental_insights,compensation_signals,narrative}',
      'strength', 3,
      'confidence', 0.75
    ));
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_signals)
  LOOP
    v_key := v_item ->> 'type';
    v_hash := encode(extensions.digest(
      'employer_analysis:' || p_company_id::text || ':signal:' || v_key,
      'sha256'
    ), 'hex');
    v_signal_hashes := array_append(v_signal_hashes, v_hash);

    UPDATE public.company_signal_atoms
    SET signal_type = v_key,
        label = v_item ->> 'label',
        description = nullif(v_item ->> 'description', ''),
        signal_strength = (v_item ->> 'strength')::integer,
        confidence_score = (v_item ->> 'confidence')::numeric,
        observed_at = v_now,
        expires_at = v_now + interval '90 days',
        is_active = true,
        refreshed_at = v_now,
        stale_at = NULL
    WHERE company_id = p_company_id
      AND source = 'employer_analysis'
      AND source_hash = v_hash;

    IF NOT FOUND THEN
      INSERT INTO public.company_signal_atoms (
        company_id, signal_type, label, description, signal_strength,
        confidence_score, observed_at, expires_at, is_active, source,
        source_hash, refreshed_at, stale_at
      ) VALUES (
        p_company_id, v_key, v_item ->> 'label', nullif(v_item ->> 'description', ''),
        (v_item ->> 'strength')::integer, (v_item ->> 'confidence')::numeric,
        v_now, v_now + interval '90 days', true, 'employer_analysis',
        v_hash, v_now, NULL
      );
    END IF;
    v_signal_upserted := v_signal_upserted + 1;
  END LOOP;

  UPDATE public.company_profile_atoms
  SET is_active = false, stale_at = v_now, refreshed_at = v_now
  WHERE company_id = p_company_id
    AND source = 'employer_analysis'
    AND is_active
    AND (
      coalesce(array_length(v_profile_hashes, 1), 0) = 0
      OR NOT (source_hash = ANY(v_profile_hashes))
    );
  GET DIAGNOSTICS v_deactivated = ROW_COUNT;

  UPDATE public.company_signal_atoms
  SET is_active = false, stale_at = v_now, refreshed_at = v_now
  WHERE company_id = p_company_id
    AND source = 'employer_analysis'
    AND is_active
    AND (
      coalesce(array_length(v_signal_hashes, 1), 0) = 0
      OR NOT (source_hash = ANY(v_signal_hashes))
    );
  GET DIAGNOSTICS v_signal_deactivated = ROW_COUNT;
  v_deactivated := v_deactivated + v_signal_deactivated;

  RETURN jsonb_build_object(
    'profile_upserted', v_profile_upserted,
    'signal_upserted', v_signal_upserted,
    'deactivated', v_deactivated
  );
END
$$;

REVOKE ALL ON FUNCTION public._refresh_company_analysis_atoms(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._refresh_company_analysis_atoms(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public._sync_company_analysis_atoms_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  PERFORM public._refresh_company_analysis_atoms(NEW.id);
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public._sync_company_analysis_atoms_trigger()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_company_analysis_atoms_after_analysis
  ON public.companies;
CREATE TRIGGER sync_company_analysis_atoms_after_analysis
  AFTER UPDATE OF employer_analysis_v2 ON public.companies
  FOR EACH ROW
  WHEN (NEW.employer_analysis_v2 IS DISTINCT FROM OLD.employer_analysis_v2)
  EXECUTE FUNCTION public._sync_company_analysis_atoms_trigger();

DO $$
DECLARE
  v_company_id uuid;
BEGIN
  FOR v_company_id IN
    SELECT id FROM public.companies WHERE employer_analysis_v2 IS NOT NULL
  LOOP
    PERFORM public._refresh_company_analysis_atoms(v_company_id);
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
