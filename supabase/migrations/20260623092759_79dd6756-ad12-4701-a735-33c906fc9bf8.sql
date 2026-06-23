-- Shared employer-analysis read contract, versioned admin/user weighting and
-- model-run observability. Raw 8+5 scores remain immutable inputs to weighting.

CREATE TABLE public.employer_analysis_weight_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_key text NOT NULL DEFAULT 'public_default',
  version integer NOT NULL CHECK (version > 0),
  employer_weights jsonb NOT NULL,
  ai_weights jsonb NOT NULL,
  note text,
  is_active boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employer_analysis_weight_profiles_key_version_unique
    UNIQUE (profile_key, version),
  CONSTRAINT employer_analysis_weight_profiles_employer_object_chk
    CHECK (jsonb_typeof(employer_weights) = 'object'),
  CONSTRAINT employer_analysis_weight_profiles_ai_object_chk
    CHECK (jsonb_typeof(ai_weights) = 'object')
);

CREATE UNIQUE INDEX employer_analysis_weight_profiles_one_active
  ON public.employer_analysis_weight_profiles (profile_key)
  WHERE is_active;

CREATE TABLE public.user_employer_analysis_weights (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  employer_weights jsonb NOT NULL,
  ai_weights jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_employer_analysis_weights_employer_object_chk
    CHECK (jsonb_typeof(employer_weights) = 'object'),
  CONSTRAINT user_employer_analysis_weights_ai_object_chk
    CHECK (jsonb_typeof(ai_weights) = 'object')
);

CREATE TABLE public.employer_analysis_model_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  benchmark_group_id uuid,
  run_mode text NOT NULL DEFAULT 'production'
    CHECK (run_mode IN ('production', 'benchmark')),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'failed')),
  research_provider text NOT NULL,
  research_model text NOT NULL,
  analysis_provider text NOT NULL,
  analysis_model text NOT NULL,
  pricing_snapshot_date date,
  research_input_tokens integer CHECK (research_input_tokens IS NULL OR research_input_tokens >= 0),
  research_output_tokens integer CHECK (research_output_tokens IS NULL OR research_output_tokens >= 0),
  analysis_input_tokens integer CHECK (analysis_input_tokens IS NULL OR analysis_input_tokens >= 0),
  analysis_output_tokens integer CHECK (analysis_output_tokens IS NULL OR analysis_output_tokens >= 0),
  web_search_requests integer CHECK (web_search_requests IS NULL OR web_search_requests >= 0),
  research_duration_ms integer CHECK (research_duration_ms IS NULL OR research_duration_ms >= 0),
  analysis_duration_ms integer CHECK (analysis_duration_ms IS NULL OR analysis_duration_ms >= 0),
  estimated_cost_usd numeric CHECK (estimated_cost_usd IS NULL OR estimated_cost_usd >= 0),
  cost_estimate_complete boolean NOT NULL DEFAULT true,
  source_count integer CHECK (source_count IS NULL OR source_count >= 0),
  scored_employer_dimensions integer
    CHECK (scored_employer_dimensions IS NULL OR scored_employer_dimensions BETWEEN 0 AND 8),
  scored_ai_dimensions integer
    CHECK (scored_ai_dimensions IS NULL OR scored_ai_dimensions BETWEEN 0 AND 5),
  financial_fallback_used boolean NOT NULL DEFAULT false,
  result_snapshot jsonb,
  error_summary text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employer_analysis_model_runs_result_object_chk
    CHECK (result_snapshot IS NULL OR jsonb_typeof(result_snapshot) = 'object')
);

CREATE INDEX employer_analysis_model_runs_company_started_idx
  ON public.employer_analysis_model_runs (company_id, started_at DESC);
CREATE INDEX employer_analysis_model_runs_mode_started_idx
  ON public.employer_analysis_model_runs (run_mode, started_at DESC);
CREATE INDEX employer_analysis_model_runs_benchmark_group_idx
  ON public.employer_analysis_model_runs (benchmark_group_id, started_at)
  WHERE benchmark_group_id IS NOT NULL;

CREATE TABLE public.employer_analysis_model_run_reviews (
  run_id uuid NOT NULL REFERENCES public.employer_analysis_model_runs(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  factual_accuracy smallint NOT NULL CHECK (factual_accuracy BETWEEN 1 AND 5),
  source_quality smallint NOT NULL CHECK (source_quality BETWEEN 1 AND 5),
  scope_precision smallint NOT NULL CHECK (scope_precision BETWEEN 1 AND 5),
  financial_quality smallint NOT NULL CHECK (financial_quality BETWEEN 1 AND 5),
  analysis_quality smallint NOT NULL CHECK (analysis_quality BETWEEN 1 AND 5),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, reviewer_id)
);

CREATE TRIGGER set_user_employer_analysis_weights_updated_at
  BEFORE UPDATE ON public.user_employer_analysis_weights
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_employer_analysis_model_run_reviews_updated_at
  BEFORE UPDATE ON public.employer_analysis_model_run_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.employer_analysis_weight_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_employer_analysis_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_analysis_model_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_analysis_model_run_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY employer_analysis_weight_profiles_admin_select
  ON public.employer_analysis_weight_profiles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY user_employer_analysis_weights_select_own
  ON public.user_employer_analysis_weights
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY employer_analysis_model_runs_admin_select
  ON public.employer_analysis_model_runs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY employer_analysis_model_run_reviews_admin_select
  ON public.employer_analysis_model_run_reviews
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

REVOKE ALL ON public.employer_analysis_weight_profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.user_employer_analysis_weights FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.employer_analysis_model_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.employer_analysis_model_run_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.employer_analysis_weight_profiles TO authenticated;
GRANT SELECT ON public.user_employer_analysis_weights TO authenticated;
GRANT SELECT ON public.employer_analysis_model_runs TO authenticated;
GRANT SELECT ON public.employer_analysis_model_run_reviews TO authenticated;
GRANT ALL ON public.employer_analysis_weight_profiles TO service_role;
GRANT ALL ON public.user_employer_analysis_weights TO service_role;
GRANT ALL ON public.employer_analysis_model_runs TO service_role;
GRANT ALL ON public.employer_analysis_model_run_reviews TO service_role;

CREATE OR REPLACE FUNCTION public._employer_analysis_default_weights(p_group text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_group
    WHEN 'employer' THEN jsonb_build_object(
      'culture', 1,
      'leadership', 1,
      'work_environment', 1,
      'career_development', 1,
      'financial_stability', 1,
      'mission', 1,
      'talent_attraction_retention', 1,
      'diversity_inclusion', 1
    )
    WHEN 'ai' THEN jsonb_build_object(
      'strategy_and_leadership', 1,
      'capability_and_deployment', 1,
      'workforce', 1,
      'governance', 1,
      'market_and_product', 1
    )
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public._employer_analysis_expected_keys(p_group text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_group
    WHEN 'employer' THEN ARRAY[
      'culture', 'leadership', 'work_environment', 'career_development',
      'financial_stability', 'mission', 'talent_attraction_retention',
      'diversity_inclusion'
    ]::text[]
    WHEN 'ai' THEN ARRAY[
      'strategy_and_leadership', 'capability_and_deployment', 'workforce',
      'governance', 'market_and_product'
    ]::text[]
    ELSE ARRAY[]::text[]
  END;
$$;

CREATE OR REPLACE FUNCTION public._employer_analysis_weights_valid(
  p_weights jsonb,
  p_group text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expected text[] := public._employer_analysis_expected_keys(p_group);
  v_key text;
  v_value jsonb;
  v_number numeric;
  v_sum numeric := 0;
  v_count integer := 0;
BEGIN
  IF cardinality(v_expected) = 0 OR jsonb_typeof(p_weights) <> 'object' THEN
    RETURN false;
  END IF;

  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_weights)
  LOOP
    IF NOT (v_key = ANY(v_expected)) OR jsonb_typeof(v_value) <> 'number' THEN
      RETURN false;
    END IF;
    v_number := (v_value #>> '{}')::numeric;
    IF v_number < 0 OR v_number > 10 THEN
      RETURN false;
    END IF;
    v_sum := v_sum + v_number;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count = cardinality(v_expected) AND v_sum > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public._employer_analysis_weighted_score(
  p_analysis jsonb,
  p_weights jsonb,
  p_group text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_weights jsonb;
  v_expected text[] := public._employer_analysis_expected_keys(p_group);
  v_item jsonb;
  v_key text;
  v_score numeric;
  v_weight numeric;
  v_numerator numeric := 0;
  v_available_weight numeric := 0;
  v_total_weight numeric := 0;
  v_scored integer := 0;
BEGIN
  IF cardinality(v_expected) = 0 THEN
    RAISE EXCEPTION 'invalid_weight_group' USING ERRCODE = '22023';
  END IF;

  v_weights := CASE
    WHEN public._employer_analysis_weights_valid(p_weights, p_group) THEN p_weights
    ELSE public._employer_analysis_default_weights(p_group)
  END;

  SELECT coalesce(sum((v_weights ->> k)::numeric), 0)
  INTO v_total_weight
  FROM unnest(v_expected) AS k;

  IF p_group = 'employer' THEN
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(coalesce(p_analysis -> 'dimensions', '[]'::jsonb))
    LOOP
      v_key := v_item ->> 'key';
      IF v_key = ANY(v_expected) AND jsonb_typeof(v_item -> 'score') = 'number' THEN
        v_score := (v_item ->> 'score')::numeric;
        v_weight := (v_weights ->> v_key)::numeric;
        v_numerator := v_numerator + (v_score * v_weight);
        v_available_weight := v_available_weight + v_weight;
        v_scored := v_scored + 1;
      END IF;
    END LOOP;
  ELSIF coalesce((p_analysis #>> '{ai_maturity,applicable}')::boolean, true) THEN
    FOR v_key, v_item IN
      SELECT key, value
      FROM jsonb_each(coalesce(p_analysis #> '{ai_maturity,signals}', '{}'::jsonb))
    LOOP
      IF v_key = ANY(v_expected) AND jsonb_typeof(v_item -> 'score') = 'number' THEN
        v_score := (v_item ->> 'score')::numeric;
        v_weight := (v_weights ->> v_key)::numeric;
        v_numerator := v_numerator + (v_score * v_weight);
        v_available_weight := v_available_weight + v_weight;
        v_scored := v_scored + 1;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'score', CASE WHEN v_available_weight > 0
      THEN round(v_numerator / v_available_weight, 2) ELSE NULL END,
    'scored_dimensions', v_scored,
    'total_dimensions', cardinality(v_expected),
    'weight_coverage_percent', CASE WHEN v_total_weight > 0
      THEN round((v_available_weight / v_total_weight) * 100, 1) ELSE 0 END
  );
END;
$$;

REVOKE ALL ON FUNCTION public._employer_analysis_default_weights(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._employer_analysis_expected_keys(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._employer_analysis_weights_valid(jsonb, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._employer_analysis_weighted_score(jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._employer_analysis_default_weights(text) TO service_role;
GRANT EXECUTE ON FUNCTION public._employer_analysis_expected_keys(text) TO service_role;
GRANT EXECUTE ON FUNCTION public._employer_analysis_weights_valid(jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public._employer_analysis_weighted_score(jsonb, jsonb, text) TO service_role;

INSERT INTO public.employer_analysis_weight_profiles (
  profile_key,
  version,
  employer_weights,
  ai_weights,
  note,
  is_active
)
VALUES (
  'public_default',
  1,
  public._employer_analysis_default_weights('employer'),
  public._employer_analysis_default_weights('ai'),
  'Initial equal-weight profile',
  true
)
ON CONFLICT (profile_key, version) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_my_employer_analysis_weights(
  p_employer_weights jsonb,
  p_ai_weights jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF NOT public._employer_analysis_weights_valid(p_employer_weights, 'employer')
     OR NOT public._employer_analysis_weights_valid(p_ai_weights, 'ai') THEN
    RAISE EXCEPTION 'invalid_employer_analysis_weights' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.user_employer_analysis_weights (
    user_id, employer_weights, ai_weights
  ) VALUES (
    v_uid, p_employer_weights, p_ai_weights
  )
  ON CONFLICT (user_id) DO UPDATE SET
    employer_weights = excluded.employer_weights,
    ai_weights = excluded.ai_weights,
    updated_at = now();

  RETURN jsonb_build_object(
    'employer_weights', p_employer_weights,
    'ai_weights', p_ai_weights,
    'is_customized', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_employer_analysis_weights(jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_employer_analysis_weights(jsonb, jsonb)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.reset_my_employer_analysis_weights()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.user_employer_analysis_weights WHERE user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.reset_my_employer_analysis_weights()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_my_employer_analysis_weights()
  TO authenticated;

CREATE OR REPLACE FUNCTION public.set_employer_analysis_weight_profile(
  p_employer_weights jsonb,
  p_ai_weights jsonb,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_version integer;
  v_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  IF NOT public._employer_analysis_weights_valid(p_employer_weights, 'employer')
     OR NOT public._employer_analysis_weights_valid(p_ai_weights, 'ai') THEN
    RAISE EXCEPTION 'invalid_employer_analysis_weights' USING ERRCODE = '22023';
  END IF;

  LOCK TABLE public.employer_analysis_weight_profiles IN SHARE ROW EXCLUSIVE MODE;
  SELECT coalesce(max(version), 0) + 1
  INTO v_version
  FROM public.employer_analysis_weight_profiles
  WHERE profile_key = 'public_default';

  UPDATE public.employer_analysis_weight_profiles
  SET is_active = false
  WHERE profile_key = 'public_default' AND is_active;

  INSERT INTO public.employer_analysis_weight_profiles (
    profile_key, version, employer_weights, ai_weights, note, is_active, created_by
  ) VALUES (
    'public_default', v_version, p_employer_weights, p_ai_weights,
    nullif(trim(p_note), ''), true, v_uid
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'version', v_version, 'is_active', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_employer_analysis_weight_profile(jsonb, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_employer_analysis_weight_profile(jsonb, jsonb, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_employer_analysis_weight_config()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.employer_analysis_weight_profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_profile
  FROM public.employer_analysis_weight_profiles
  WHERE profile_key = 'public_default' AND is_active
  ORDER BY version DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'id', v_profile.id,
    'version', v_profile.version,
    'employer_weights', v_profile.employer_weights,
    'ai_weights', v_profile.ai_weights,
    'note', v_profile.note,
    'created_at', v_profile.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_employer_analysis_weight_config()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employer_analysis_weight_config()
  TO authenticated;

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

  v_analysis := v_company.employer_analysis_v2;
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
GRANT EXECUTE ON FUNCTION public.get_employer_analysis_view(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_employer_analysis_view(text) IS
  'Canonical public/authenticated employer-analysis read model. Both audiences receive the same analysis; authenticated users additionally receive their own weighted totals.';

CREATE OR REPLACE FUNCTION public.review_employer_analysis_model_run(
  p_run_id uuid,
  p_factual_accuracy smallint,
  p_source_quality smallint,
  p_scope_precision smallint,
  p_financial_quality smallint,
  p_analysis_quality smallint,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  IF p_factual_accuracy NOT BETWEEN 1 AND 5
     OR p_source_quality NOT BETWEEN 1 AND 5
     OR p_scope_precision NOT BETWEEN 1 AND 5
     OR p_financial_quality NOT BETWEEN 1 AND 5
     OR p_analysis_quality NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'review_scores_must_be_1_to_5' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.employer_analysis_model_runs
    WHERE id = p_run_id AND run_mode = 'benchmark'
  ) THEN
    RAISE EXCEPTION 'benchmark_run_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.employer_analysis_model_run_reviews (
    run_id, reviewer_id, factual_accuracy, source_quality, scope_precision,
    financial_quality, analysis_quality, notes
  ) VALUES (
    p_run_id, v_uid, p_factual_accuracy, p_source_quality, p_scope_precision,
    p_financial_quality, p_analysis_quality, nullif(trim(p_notes), '')
  )
  ON CONFLICT (run_id, reviewer_id) DO UPDATE SET
    factual_accuracy = excluded.factual_accuracy,
    source_quality = excluded.source_quality,
    scope_precision = excluded.scope_precision,
    financial_quality = excluded.financial_quality,
    analysis_quality = excluded.analysis_quality,
    notes = excluded.notes;

  RETURN jsonb_build_object('run_id', p_run_id, 'reviewer_id', v_uid, 'saved', true);
END;
$$;

REVOKE ALL ON FUNCTION public.review_employer_analysis_model_run(
  uuid, smallint, smallint, smallint, smallint, smallint, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_employer_analysis_model_run(
  uuid, smallint, smallint, smallint, smallint, smallint, text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_employer_analysis_benchmark_report(
  p_benchmark_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'run_id', r.id,
    'company_id', r.company_id,
    'status', r.status,
    'research_provider', r.research_provider,
    'research_model', r.research_model,
    'analysis_model', r.analysis_model,
    'source_count', r.source_count,
    'scored_employer_dimensions', r.scored_employer_dimensions,
    'scored_ai_dimensions', r.scored_ai_dimensions,
    'financial_fallback_used', r.financial_fallback_used,
    'research_duration_ms', r.research_duration_ms,
    'analysis_duration_ms', r.analysis_duration_ms,
    'estimated_cost_usd', r.estimated_cost_usd,
    'cost_estimate_complete', r.cost_estimate_complete,
    'result_snapshot', r.result_snapshot,
    'review', CASE WHEN rv.run_id IS NULL THEN NULL ELSE jsonb_build_object(
      'factual_accuracy', rv.factual_accuracy,
      'source_quality', rv.source_quality,
      'scope_precision', rv.scope_precision,
      'financial_quality', rv.financial_quality,
      'analysis_quality', rv.analysis_quality,
      'average', round((
        rv.factual_accuracy + rv.source_quality + rv.scope_precision +
        rv.financial_quality + rv.analysis_quality
      )::numeric / 5, 2),
      'notes', rv.notes
    ) END,
    'started_at', r.started_at,
    'finished_at', r.finished_at,
    'error_summary', r.error_summary
  ) ORDER BY r.started_at), '[]'::jsonb)
  INTO v_result
  FROM public.employer_analysis_model_runs r
  LEFT JOIN public.employer_analysis_model_run_reviews rv
    ON rv.run_id = r.id AND rv.reviewer_id = v_uid
  WHERE r.benchmark_group_id = p_benchmark_group_id;

  RETURN jsonb_build_object(
    'benchmark_group_id', p_benchmark_group_id,
    'runs', v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_employer_analysis_benchmark_report(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employer_analysis_benchmark_report(uuid)
  TO authenticated;

NOTIFY pgrst, 'reload schema';