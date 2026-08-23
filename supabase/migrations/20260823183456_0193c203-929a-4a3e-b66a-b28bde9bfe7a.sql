CREATE OR REPLACE FUNCTION public.get_employer_review_aggregate(
  p_review_target_id uuid,
  p_cohort public.employer_experience_cohort DEFAULT 'employee_experience'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_contributors integer;
  v_dims jsonb;
  v_texts jsonb;
  v_threshold constant integer := 2;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Ikke innlogget'; END IF;
  IF p_cohort = 'not_eligible' THEN
    RETURN jsonb_build_object('cohort', p_cohort, 'threshold', v_threshold,
      'contributor_count', 0, 'dimensions', '[]'::jsonb, 'texts', '[]'::jsonb, 'has_weighted_total', false);
  END IF;

  SELECT count(DISTINCT r.id) INTO v_contributors
    FROM public.employer_reviews r
   WHERE r.review_target_id = p_review_target_id
     AND r.experience_cohort = p_cohort
     AND r.is_active
     AND r.numeric_contribution_status = 'eligible_for_aggregate';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'dimension', a.dimension,
           'average_score', a.average_score,
           'contributor_count', a.contributor_count) ORDER BY a.dimension), '[]'::jsonb)
    INTO v_dims
    FROM public.employer_review_aggregates a
   WHERE a.review_target_id = p_review_target_id
     AND a.experience_cohort = p_cohort
     AND a.contributor_count >= v_threshold;

  IF v_contributors >= v_threshold THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'excerpt', t.anonymized_excerpt,
             'basis', r.experience_basis,
             'period', to_char(r.submitted_at, 'YYYY')) ORDER BY r.submitted_at DESC), '[]'::jsonb)
      INTO v_texts
      FROM public.employer_review_texts t
      JOIN public.employer_reviews r ON r.id = t.review_id
     WHERE r.review_target_id = p_review_target_id
       AND r.experience_cohort = p_cohort
       AND r.is_active
       AND t.publication_status = 'approved'
       AND t.anonymized_excerpt IS NOT NULL;
  ELSE
    v_texts := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'cohort', p_cohort,
    'threshold', v_threshold,
    'contributor_count', v_contributors,
    'dimensions', v_dims,
    'texts', v_texts,
    'has_weighted_total', (v_contributors >= v_threshold AND jsonb_array_length(v_dims) = 8)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_employer_review_aggregate(uuid, public.employer_experience_cohort) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employer_review_aggregate(uuid, public.employer_experience_cohort) TO authenticated;

CREATE OR REPLACE FUNCTION public.employer_review_search_status(p_organisasjonsnumre text[])
RETURNS TABLE (organisasjonsnummer text, has_public_aggregate boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT o.orgnr,
         EXISTS (
           SELECT 1
             FROM public.employer_review_targets t
             JOIN public.employer_review_aggregates a ON a.review_target_id = t.id
            WHERE t.organisasjonsnummer = o.orgnr
              AND t.superseded_at IS NULL
              AND a.experience_cohort <> 'not_eligible'
              AND a.contributor_count >= 2
         )
    FROM unnest(coalesce(p_organisasjonsnumre, ARRAY[]::text[])) AS o(orgnr)
   WHERE auth.uid() IS NOT NULL
   LIMIT 50;
$$;
REVOKE ALL ON FUNCTION public.employer_review_search_status(text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.employer_review_search_status(text[]) TO authenticated;