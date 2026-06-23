-- Shared employer-analysis weighting contract. Operator role, BEGIN/ROLLBACK.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.must(p_label text, p_condition boolean)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(p_condition, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'ASSERTION FAILED: %', p_label;
  END IF;
  RAISE NOTICE 'PASS: %', p_label;
END;
$$;

DO $$
DECLARE
  v_analysis jsonb := jsonb_build_object(
    'dimensions', jsonb_build_array(
      jsonb_build_object('key', 'culture', 'score', 5),
      jsonb_build_object('key', 'leadership', 'score', 1),
      jsonb_build_object('key', 'work_environment', 'score', NULL),
      jsonb_build_object('key', 'career_development', 'score', 3)
    ),
    'ai_maturity', jsonb_build_object(
      'applicable', true,
      'signals', jsonb_build_object(
        'strategy_and_leadership', jsonb_build_object('score', 4),
        'capability_and_deployment', jsonb_build_object('score', 2),
        'workforce', jsonb_build_object('score', NULL)
      )
    )
  );
  v_employer_weights jsonb := public._employer_analysis_default_weights('employer');
  v_ai_weights jsonb := public._employer_analysis_default_weights('ai');
  v_weighted jsonb;
  v_orgnr text;
  v_company_id uuid;
  v_view jsonb;
BEGIN
  PERFORM pg_temp.must(
    'default employer weights validate',
    public._employer_analysis_weights_valid(v_employer_weights, 'employer')
  );
  PERFORM pg_temp.must(
    'default AI weights validate',
    public._employer_analysis_weights_valid(v_ai_weights, 'ai')
  );
  PERFORM pg_temp.must(
    'missing employer key is rejected',
    NOT public._employer_analysis_weights_valid(v_employer_weights - 'culture', 'employer')
  );
  PERFORM pg_temp.must(
    'unknown key is rejected',
    NOT public._employer_analysis_weights_valid(v_employer_weights || '{"unknown":1}'::jsonb, 'employer')
  );
  PERFORM pg_temp.must(
    'negative weight is rejected',
    NOT public._employer_analysis_weights_valid(
      jsonb_set(v_employer_weights, '{culture}', '-1'::jsonb),
      'employer'
    )
  );

  v_weighted := public._employer_analysis_weighted_score(
    v_analysis,
    jsonb_set(v_employer_weights, '{culture}', '3'::jsonb),
    'employer'
  );
  PERFORM pg_temp.must(
    'weighted employer score uses configured weights',
    (v_weighted ->> 'score')::numeric = 4
  );
  PERFORM pg_temp.must(
    'null employer scores are excluded from denominator',
    (v_weighted ->> 'scored_dimensions')::integer = 3
  );

  v_weighted := public._employer_analysis_weighted_score(v_analysis, v_ai_weights, 'ai');
  PERFORM pg_temp.must(
    'AI score renormalizes over available signals',
    (v_weighted ->> 'score')::numeric = 3
      AND (v_weighted ->> 'scored_dimensions')::integer = 2
  );

  SELECT e.organisasjonsnummer INTO v_orgnr
  FROM reg.enheter e
  WHERE coalesce(e.slettet, false) = false
  ORDER BY e.organisasjonsnummer
  LIMIT 1;
  v_company_id := public.ensure_company_for_employer(v_orgnr);
  UPDATE public.companies
  SET employer_analysis_v2 = v_analysis,
      employer_analysis_version = 2,
      employer_analysis_rated_at = now()
  WHERE id = v_company_id;
  v_view := public.get_employer_analysis_view(v_orgnr);
  PERFORM pg_temp.must('canonical view resolves register entity', v_view ->> 'organisasjonsnummer' = v_orgnr);
  PERFORM pg_temp.must('canonical view returns the stored analysis', v_view -> 'analysis' = v_analysis);
  PERFORM pg_temp.must('canonical view exposes public weighting', v_view #> '{weighting,public}' IS NOT NULL);
  PERFORM pg_temp.must(
    'canonical view applies active admin profile',
    (v_view #>> '{weighting,public,employer,score}')::numeric = 3
  );
  PERFORM pg_temp.must('operator call has no personal block', v_view #> '{weighting,personal}' = 'null'::jsonb);

  PERFORM pg_temp.must(
    'exactly one active public weight profile',
    (SELECT count(*) FROM public.employer_analysis_weight_profiles
      WHERE profile_key = 'public_default' AND is_active) = 1
  );
  PERFORM pg_temp.must(
    'authenticated cannot write model runs',
    NOT has_table_privilege('authenticated', 'public.employer_analysis_model_runs', 'INSERT')
  );
  PERFORM pg_temp.must(
    'authenticated reviews only through admin-gated RPC',
    has_function_privilege(
      'authenticated',
      'public.review_employer_analysis_model_run(uuid,smallint,smallint,smallint,smallint,smallint,text)',
      'EXECUTE'
    )
      AND NOT has_table_privilege(
        'authenticated', 'public.employer_analysis_model_run_reviews', 'INSERT'
      )
  );
  PERFORM pg_temp.must(
    'anon can read canonical RPC only',
    has_function_privilege('anon', 'public.get_employer_analysis_view(text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.set_my_employer_analysis_weights(jsonb,jsonb)', 'EXECUTE')
  );
  PERFORM pg_temp.must(
    'authenticated can manage own weights only through RPC',
    has_function_privilege('authenticated', 'public.set_my_employer_analysis_weights(jsonb,jsonb)', 'EXECUTE')
      AND NOT has_table_privilege('authenticated', 'public.user_employer_analysis_weights', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.user_employer_analysis_weights', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.user_employer_analysis_weights', 'DELETE')
  );

  RAISE NOTICE 'Employer analysis shared weighting tests PASS';
END;
$$;

ROLLBACK;
