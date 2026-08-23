
CREATE OR REPLACE FUNCTION public.employer_review_ensure_target_by_orgnr(p_organisasjonsnummer text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'reg', 'pg_temp'
AS $$
DECLARE
  v_orgnr text := regexp_replace(coalesce(p_organisasjonsnummer, ''), '\D', '', 'g');
  v_company_id uuid;
  v_name text;
  v_target_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Ikke innlogget'; END IF;
  IF v_orgnr !~ '^[0-9]{9}$' THEN
    RAISE EXCEPTION 'invalid_organisasjonsnummer' USING ERRCODE = '22023';
  END IF;

  -- Kanonisk selskapsrad fra registeret (idempotent, ingen analyse/score/vurdering)
  v_company_id := public.ensure_company_for_employer(v_orgnr);
  IF v_company_id IS NULL THEN
    SELECT id INTO v_company_id FROM public.companies WHERE organisasjonsnummer = v_orgnr;
  END IF;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'employer_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT name INTO v_name FROM public.companies WHERE id = v_company_id;

  SELECT id INTO v_target_id FROM public.employer_review_targets
   WHERE company_id = v_company_id AND target_kind = 'juridisk_enhet' AND superseded_at IS NULL;

  IF v_target_id IS NULL THEN
    INSERT INTO public.employer_review_targets (target_kind, company_id, organisasjonsnummer, display_name)
    VALUES ('juridisk_enhet', v_company_id, v_orgnr, coalesce(v_name, v_orgnr))
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_target_id;
  END IF;

  IF v_target_id IS NULL THEN
    SELECT id INTO v_target_id FROM public.employer_review_targets
     WHERE company_id = v_company_id AND target_kind = 'juridisk_enhet' AND superseded_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'target_id', v_target_id,
    'company_id', v_company_id,
    'organisasjonsnummer', v_orgnr
  );
END;
$$;

REVOKE ALL ON FUNCTION public.employer_review_ensure_target_by_orgnr(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.employer_review_ensure_target_by_orgnr(text) TO authenticated;

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
              AND a.contributor_count >= 5
         )
    FROM unnest(coalesce(p_organisasjonsnumre, ARRAY[]::text[])) AS o(orgnr)
   WHERE auth.uid() IS NOT NULL
   LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.employer_review_search_status(text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.employer_review_search_status(text[]) TO authenticated;
