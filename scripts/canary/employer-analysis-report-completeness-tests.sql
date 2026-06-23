-- Employer-analysis report completeness and automatic atom sync. BEGIN/ROLLBACK.

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
  v_company_id uuid;
  v_analysis jsonb;
  v_expected_profiles integer;
  v_result jsonb;
  v_projection jsonb;
BEGIN
  PERFORM pg_temp.must(
    'private candidate scenario column exists',
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'user_company_ratings'
        AND column_name = 'ai_candidate_scenario_notes'
        AND data_type = 'jsonb'
    )
  );
  PERFORM pg_temp.must(
    'candidate scenario default is an array',
    NOT EXISTS (
      SELECT 1 FROM public.user_company_ratings
      WHERE jsonb_typeof(ai_candidate_scenario_notes) <> 'array'
    )
  );
  PERFORM pg_temp.must(
    'analysis atom trigger is enabled',
    EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgrelid = 'public.companies'::regclass
        AND tgname = 'sync_company_analysis_atoms_after_analysis'
        AND tgenabled <> 'D'
        AND NOT tgisinternal
    )
  );
  PERFORM pg_temp.must(
    'atom refresh helper is security definer',
    EXISTS (
      SELECT 1
      FROM pg_proc
      WHERE oid = 'public._refresh_company_analysis_atoms(uuid)'::regprocedure
        AND prosecdef
    )
  );
  PERFORM pg_temp.must(
    'atom refresh helper is not client executable',
    NOT has_function_privilege('anon', 'public._refresh_company_analysis_atoms(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public._refresh_company_analysis_atoms(uuid)', 'EXECUTE')
  );
  v_projection := public._employer_analysis_public_projection(jsonb_build_object(
    'sources', jsonb_build_array(
      jsonb_build_object('id', 1, 'category', 'employee_reviews', 'url', 'https://glassdoor.example/reviews'),
      jsonb_build_object('id', 2, 'category', 'salary_benchmark', 'url', 'https://levels.fyi/company'),
      jsonb_build_object('id', 3, 'category', 'official_company', 'url', 'https://example.com/annual-report')
    )
  ));
  PERFORM pg_temp.must(
    'public projection hides evaluation and salary platforms',
    jsonb_array_length(v_projection -> 'sources') = 1
      AND v_projection #>> '{sources,0,url}' = 'https://example.com/annual-report'
  );

  SELECT id, employer_analysis_v2
    INTO v_company_id, v_analysis
  FROM public.companies
  WHERE employer_analysis_v2 IS NOT NULL
  ORDER BY employer_analysis_rated_at DESC NULLS LAST
  LIMIT 1;

  PERFORM pg_temp.must('at least one canonical employer analysis exists', v_company_id IS NOT NULL);

  SELECT count(*)::integer
    INTO v_expected_profiles
  FROM jsonb_array_elements(coalesce(v_analysis -> 'dimensions', '[]'::jsonb)) item
  WHERE jsonb_typeof(item -> 'score') = 'number'
    AND coalesce(item ->> 'evidence_status', 'insufficient_evidence') <> 'insufficient_evidence';

  v_result := public._refresh_company_analysis_atoms(v_company_id);
  PERFORM pg_temp.must(
    'atom refresh reports every scored dimension',
    (v_result ->> 'profile_upserted')::integer = v_expected_profiles
  );
  PERFORM pg_temp.must(
    'active analysis profile atoms match scored dimensions',
    (
      SELECT count(*)
      FROM public.company_profile_atoms
      WHERE company_id = v_company_id
        AND source = 'employer_analysis'
        AND is_active
    ) = v_expected_profiles
  );
  PERFORM pg_temp.must(
    'analysis profile atom hashes are unique',
    (
      SELECT count(*) = count(DISTINCT source_hash)
      FROM public.company_profile_atoms
      WHERE company_id = v_company_id
        AND source = 'employer_analysis'
        AND is_active
    )
  );

  RAISE NOTICE 'Employer analysis report completeness tests PASS';
END;
$$;

ROLLBACK;
