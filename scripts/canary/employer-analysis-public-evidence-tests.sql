\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.must(p_label text, p_condition boolean)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: %', p_label;
  END IF;
  RAISE NOTICE 'PASS: %', p_label;
END
$$;

DO $$
DECLARE
  v_projection jsonb;
  v_orphans integer;
BEGIN
  v_projection := public._employer_analysis_public_projection(jsonb_build_object(
    'sources', jsonb_build_array(
      jsonb_build_object('id', 1, 'url', 'https://example.com/report', 'category', 'annual_report'),
      jsonb_build_object('id', 2, 'url', 'https://glassdoor.com/example', 'category', 'employee_reviews')
    ),
    'dimensions', jsonb_build_array(
      jsonb_build_object('key', 'culture', 'score', 4, 'evidence_status', 'sourced', 'source_ids', jsonb_build_array(1, 2))
    ),
    'supplemental_insights', jsonb_build_object(
      'employee_sentiment_trend', jsonb_build_object(
        'evidence_status', 'sourced',
        'source_ids', jsonb_build_array(2)
      )
    )
  ));

  PERFORM pg_temp.must(
    'public source list removes evaluation platforms',
    jsonb_array_length(v_projection -> 'sources') = 1
      AND v_projection #>> '{sources,0,id}' = '1'
  );
  PERFORM pg_temp.must(
    'dimension references retain only visible source ids',
    v_projection #> '{dimensions,0,source_ids}' = '[1]'::jsonb
  );
  PERFORM pg_temp.must(
    'hidden-only sourced evidence is marked inferred',
    v_projection #>> '{supplemental_insights,employee_sentiment_trend,evidence_status}' = 'inferred'
      AND v_projection #> '{supplemental_insights,employee_sentiment_trend,source_ids}' = '[]'::jsonb
  );
  PERFORM pg_temp.must(
    'public projection contains no evaluation-platform names',
    lower(v_projection::text) !~ 'glassdoor|jobbi|indeed'
  );
  PERFORM pg_temp.must(
    'client roles cannot execute recursive evidence helper',
    NOT has_function_privilege(
      'anon',
      'public._employer_analysis_filter_public_source_ids(jsonb,bigint[])',
      'EXECUTE'
    )
      AND NOT has_function_privilege(
        'authenticated',
        'public._employer_analysis_filter_public_source_ids(jsonb,bigint[])',
        'EXECUTE'
      )
  );

  WITH projected AS (
    SELECT public._employer_analysis_public_projection(employer_analysis_v2) AS analysis
    FROM public.companies
    WHERE employer_analysis_v2 IS NOT NULL
  ), valid_ids AS (
    SELECT analysis, coalesce(array_agg((source.value ->> 'id')::bigint), '{}'::bigint[]) AS ids
    FROM projected
    LEFT JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(analysis -> 'sources') = 'array'
        THEN analysis -> 'sources' ELSE '[]'::jsonb END
    ) AS source(value) ON true
    WHERE source.value IS NULL OR source.value ->> 'id' ~ '^[0-9]+$'
    GROUP BY analysis
  ), refs AS (
    SELECT ref.value #>> '{}' AS source_id, valid_ids.ids
    FROM valid_ids
    CROSS JOIN LATERAL jsonb_path_query(
      valid_ids.analysis,
      '$.**.source_ids[*]'
    ) AS ref(value)
  )
  SELECT count(*)
  INTO v_orphans
  FROM refs
  WHERE source_id ~ '^[0-9]+$'
    AND source_id::bigint <> ALL(ids);

  PERFORM pg_temp.must('all projected analyses have zero orphan source ids', v_orphans = 0);
END
$$;

DO $$
BEGIN
  RAISE NOTICE 'Employer analysis public evidence tests PASS';
END
$$;

ROLLBACK;
