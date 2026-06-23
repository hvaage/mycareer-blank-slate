-- Keep public employer-analysis evidence references consistent with the
-- filtered source list. Internal model-run snapshots remain unchanged.

CREATE OR REPLACE FUNCTION public._employer_analysis_filter_public_source_ids(
  p_value jsonb,
  p_valid_ids bigint[]
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_filtered_ids jsonb;
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;

  CASE jsonb_typeof(p_value)
    WHEN 'object' THEN
      SELECT coalesce(
        jsonb_object_agg(
          entry.key,
          public._employer_analysis_filter_public_source_ids(entry.value, p_valid_ids)
        ),
        '{}'::jsonb
      )
      INTO v_result
      FROM jsonb_each(p_value) AS entry;

      IF p_value ? 'source_ids'
         AND jsonb_typeof(p_value -> 'source_ids') = 'array' THEN
        SELECT coalesce(jsonb_agg(item.value ORDER BY item.ordinality), '[]'::jsonb)
        INTO v_filtered_ids
        FROM jsonb_array_elements(p_value -> 'source_ids')
          WITH ORDINALITY AS item(value, ordinality)
        WHERE item.value #>> '{}' ~ '^[0-9]+$'
          AND (item.value #>> '{}')::bigint = ANY(coalesce(p_valid_ids, '{}'::bigint[]));

        v_result := jsonb_set(v_result, '{source_ids}', v_filtered_ids, true);
        IF v_result ->> 'evidence_status' = 'sourced'
           AND jsonb_array_length(v_filtered_ids) = 0 THEN
          v_result := jsonb_set(v_result, '{evidence_status}', '"inferred"'::jsonb, true);
        END IF;
      END IF;

      RETURN v_result;

    WHEN 'array' THEN
      SELECT coalesce(
        jsonb_agg(
          public._employer_analysis_filter_public_source_ids(item.value, p_valid_ids)
          ORDER BY item.ordinality
        ),
        '[]'::jsonb
      )
      INTO v_result
      FROM jsonb_array_elements(p_value) WITH ORDINALITY AS item(value, ordinality);
      RETURN v_result;

    ELSE
      RETURN p_value;
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public._employer_analysis_filter_public_source_ids(jsonb, bigint[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._employer_analysis_filter_public_source_ids(jsonb, bigint[])
  TO service_role;

CREATE OR REPLACE FUNCTION public._employer_analysis_public_projection(p_analysis jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sources jsonb;
  v_valid_ids bigint[];
  v_projection jsonb;
BEGIN
  IF p_analysis IS NULL OR jsonb_typeof(p_analysis) <> 'object' THEN
    RETURN p_analysis;
  END IF;

  SELECT coalesce(jsonb_agg(source_item.value ORDER BY source_item.ordinality), '[]'::jsonb)
  INTO v_sources
  FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(p_analysis -> 'sources') = 'array'
      THEN p_analysis -> 'sources' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS source_item(value, ordinality)
  WHERE coalesce(source_item.value ->> 'category', 'other')
      NOT IN ('employee_reviews', 'salary_benchmark')
    AND lower(coalesce(source_item.value ->> 'url', '')) !~
      '(^|[./])(glassdoor|jobbi|indeed|kununu|trustpilot|levels[.]fyi|comparably|ambitionbox|greatplacetowork)([./]|$)';

  SELECT coalesce(array_agg((source_item.value ->> 'id')::bigint), '{}'::bigint[])
  INTO v_valid_ids
  FROM jsonb_array_elements(v_sources) AS source_item(value)
  WHERE source_item.value ->> 'id' ~ '^[0-9]+$';

  v_projection := jsonb_set(p_analysis, '{sources}', v_sources, true);
  RETURN public._employer_analysis_filter_public_source_ids(v_projection, v_valid_ids);
END;
$$;

REVOKE ALL ON FUNCTION public._employer_analysis_public_projection(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._employer_analysis_public_projection(jsonb)
  TO service_role;

UPDATE public.companies
SET employer_analysis_v2 = public._employer_analysis_public_projection(employer_analysis_v2)
WHERE employer_analysis_v2 IS NOT NULL
  AND employer_analysis_v2 IS DISTINCT FROM
    public._employer_analysis_public_projection(employer_analysis_v2);

NOTIFY pgrst, 'reload schema';
