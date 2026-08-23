-- Kohort utledes deterministisk fra erfaringsgrunnlag
CREATE OR REPLACE FUNCTION public.employer_review_cohort_for_basis(p_basis public.employer_experience_basis)
RETURNS public.employer_experience_cohort
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_basis
    WHEN 'current_employee' THEN 'employee_experience'
    WHEN 'former_employee' THEN 'employee_experience'
    WHEN 'contractor' THEN 'employee_experience'
    WHEN 'applicant' THEN 'candidate_experience'
    WHEN 'interviewed' THEN 'candidate_experience'
    WHEN 'customer' THEN 'external_relationship'
    WHEN 'partner' THEN 'external_relationship'
    ELSE 'not_eligible'
  END::public.employer_experience_cohort
$$;

-- Rekalkuler aggregat for ett objekt og én kohort
CREATE OR REPLACE FUNCTION public.employer_review_refresh_aggregate(
  p_review_target_id uuid,
  p_cohort public.employer_experience_cohort
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.employer_review_aggregates
   WHERE review_target_id = p_review_target_id AND experience_cohort = p_cohort;

  INSERT INTO public.employer_review_aggregates
    (review_target_id, experience_cohort, dimension, average_score, contributor_count, insufficient_basis_count, updated_at)
  SELECT p_review_target_id,
         p_cohort,
         s.dimension,
         avg(s.score) FILTER (WHERE s.score IS NOT NULL),
         count(DISTINCT r.id) FILTER (WHERE s.score IS NOT NULL),
         count(*) FILTER (WHERE s.insufficient_basis),
         now()
    FROM public.employer_reviews r
    JOIN public.employer_review_dimension_scores s ON s.review_id = r.id
   WHERE r.review_target_id = p_review_target_id
     AND r.experience_cohort = p_cohort
     AND r.is_active
     AND r.numeric_contribution_status = 'eligible_for_aggregate'
     AND (p_cohort <> 'candidate_experience' OR s.dimension = 'talent_attraction_retention')
   GROUP BY s.dimension;
END;
$$;
REVOKE ALL ON FUNCTION public.employer_review_refresh_aggregate(uuid, public.employer_experience_cohort) FROM PUBLIC, anon, authenticated;

-- Opprett/hent verifisert juridisk enhet som vurderingsobjekt
CREATE OR REPLACE FUNCTION public.employer_review_ensure_target(p_company_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_orgnr text; v_name text; v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Ikke innlogget'; END IF;

  SELECT organisasjonsnummer, name INTO v_orgnr, v_name
    FROM public.companies WHERE id = p_company_id;
  IF v_orgnr IS NULL OR v_orgnr !~ '^[0-9]{9}$' THEN
    RAISE EXCEPTION 'Selskapet mangler verifisert organisasjonsnummer';
  END IF;

  SELECT id INTO v_id FROM public.employer_review_targets
   WHERE company_id = p_company_id AND target_kind = 'juridisk_enhet' AND superseded_at IS NULL;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.employer_review_targets (target_kind, company_id, organisasjonsnummer, display_name)
  VALUES ('juridisk_enhet', p_company_id, v_orgnr, coalesce(v_name, v_orgnr))
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.employer_review_targets
     WHERE company_id = p_company_id AND target_kind = 'juridisk_enhet' AND superseded_at IS NULL;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.employer_review_ensure_target(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employer_review_ensure_target(uuid) TO authenticated;

-- Lagre/erstatte egen vurdering
CREATE OR REPLACE FUNCTION public.employer_review_submit(
  p_review_target_id uuid,
  p_experience_basis public.employer_experience_basis,
  p_scores jsonb,
  p_text text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_cohort public.employer_experience_cohort;
  v_review uuid;
  v_prev uuid;
  v_recent integer;
  v_status public.employer_review_numeric_status;
  v_dim text;
  v_val jsonb;
  v_count integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Ikke innlogget'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employer_review_targets
                  WHERE id = p_review_target_id AND superseded_at IS NULL) THEN
    RAISE EXCEPTION 'Ukjent eller inaktivt vurderingsobjekt';
  END IF;

  -- Rate limit: maks 20 innsendinger siste døgn
  SELECT count(*) INTO v_recent FROM public.employer_reviews
   WHERE user_id = v_user AND created_at > now() - interval '24 hours';
  IF v_recent >= 20 THEN RAISE EXCEPTION 'For mange vurderinger på kort tid. Prøv igjen senere.'; END IF;

  v_cohort := public.employer_review_cohort_for_basis(p_experience_basis);

  -- Revisjon erstatter tidligere aktiv vurdering (ingen ekstra aggregatbidrag)
  SELECT id INTO v_prev FROM public.employer_reviews
   WHERE user_id = v_user AND review_target_id = p_review_target_id
     AND experience_basis = p_experience_basis AND is_active;
  IF v_prev IS NOT NULL THEN
    INSERT INTO public.employer_review_revisions (review_id, revision_kind, snapshot)
    SELECT v_prev, 'superseded', to_jsonb(r) FROM public.employer_reviews r WHERE r.id = v_prev;
    UPDATE public.employer_reviews
       SET is_active = false, numeric_contribution_status = 'withdrawn', updated_at = now()
     WHERE id = v_prev;
  END IF;

  v_status := CASE WHEN v_cohort = 'not_eligible' THEN 'draft'::public.employer_review_numeric_status
                   ELSE 'eligible_for_aggregate'::public.employer_review_numeric_status END;

  INSERT INTO public.employer_reviews
    (review_target_id, user_id, experience_basis, experience_cohort, numeric_contribution_status, submitted_at)
  VALUES (p_review_target_id, v_user, p_experience_basis, v_cohort, v_status, now())
  RETURNING id INTO v_review;

  FOR v_dim, v_val IN SELECT key, value FROM jsonb_each(coalesce(p_scores, '{}'::jsonb)) LOOP
    IF v_cohort = 'candidate_experience' AND v_dim <> 'talent_attraction_retention' THEN
      CONTINUE;
    END IF;
    IF jsonb_typeof(v_val) = 'number' THEN
      INSERT INTO public.employer_review_dimension_scores (review_id, dimension, score, insufficient_basis)
      VALUES (v_review, v_dim::public.employer_review_dimension, (v_val#>>'{}')::smallint, false);
    ELSE
      INSERT INTO public.employer_review_dimension_scores (review_id, dimension, score, insufficient_basis)
      VALUES (v_review, v_dim::public.employer_review_dimension, NULL, true);
    END IF;
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN RAISE EXCEPTION 'Vurderingen må inneholde minst ett dimensjonssvar'; END IF;

  IF p_text IS NOT NULL AND length(btrim(p_text)) > 0 THEN
    INSERT INTO public.employer_review_texts (review_id, body, publication_status)
    VALUES (v_review, btrim(p_text), 'submitted');
    INSERT INTO public.employer_review_moderation (review_id) VALUES (v_review);
  END IF;

  PERFORM public.employer_review_refresh_aggregate(p_review_target_id, v_cohort);
  RETURN v_review;
END;
$$;
REVOKE ALL ON FUNCTION public.employer_review_submit(uuid, public.employer_experience_basis, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employer_review_submit(uuid, public.employer_experience_basis, jsonb, text) TO authenticated;

-- Trekk tilbake egen vurdering
CREATE OR REPLACE FUNCTION public.employer_review_withdraw(p_review_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_target uuid; v_cohort public.employer_experience_cohort;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Ikke innlogget'; END IF;
  SELECT review_target_id, experience_cohort INTO v_target, v_cohort
    FROM public.employer_reviews WHERE id = p_review_id AND user_id = auth.uid();
  IF v_target IS NULL THEN RAISE EXCEPTION 'Fant ikke vurderingen'; END IF;

  UPDATE public.employer_reviews
     SET is_active = false, numeric_contribution_status = 'withdrawn', updated_at = now()
   WHERE id = p_review_id;
  UPDATE public.employer_review_texts
     SET publication_status = 'withdrawn', updated_at = now()
   WHERE review_id = p_review_id;

  PERFORM public.employer_review_refresh_aggregate(v_target, v_cohort);
END;
$$;
REVOKE ALL ON FUNCTION public.employer_review_withdraw(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employer_review_withdraw(uuid) TO authenticated;

-- Les aggregat med personvernterskel
CREATE OR REPLACE FUNCTION public.get_employer_review_aggregate(
  p_review_target_id uuid,
  p_cohort public.employer_experience_cohort DEFAULT 'employee_experience'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_contributors integer;
  v_dims jsonb;
  v_texts jsonb;
  v_threshold constant integer := 5;
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

-- Egen vurdering
CREATE OR REPLACE FUNCTION public.get_my_employer_review(p_review_target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Ikke innlogget'; END IF;
  SELECT jsonb_build_object(
           'id', r.id,
           'experience_basis', r.experience_basis,
           'experience_cohort', r.experience_cohort,
           'numeric_contribution_status', r.numeric_contribution_status,
           'submitted_at', r.submitted_at,
           'scores', (SELECT coalesce(jsonb_object_agg(s.dimension,
                        CASE WHEN s.insufficient_basis THEN to_jsonb('insufficient_basis'::text)
                             ELSE to_jsonb(s.score) END), '{}'::jsonb)
                        FROM public.employer_review_dimension_scores s WHERE s.review_id = r.id),
           'text', (SELECT jsonb_build_object('body', t.body, 'publication_status', t.publication_status)
                      FROM public.employer_review_texts t WHERE t.review_id = r.id))
    INTO v_row
    FROM public.employer_reviews r
   WHERE r.user_id = auth.uid() AND r.review_target_id = p_review_target_id AND r.is_active
   ORDER BY r.submitted_at DESC NULLS LAST
   LIMIT 1;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_employer_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_employer_review(uuid) TO authenticated;

-- Manuell moderering (kun admin)
CREATE OR REPLACE FUNCTION public.employer_review_moderate(
  p_review_id uuid,
  p_decision text,
  p_anonymized_excerpt text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_target uuid; v_cohort public.employer_experience_cohort;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Krever administratorrolle';
  END IF;
  IF p_decision NOT IN ('approved','needs_revision','rejected') THEN
    RAISE EXCEPTION 'Ugyldig modereringsbeslutning';
  END IF;
  IF p_decision = 'approved' AND coalesce(btrim(p_anonymized_excerpt), '') = '' THEN
    RAISE EXCEPTION 'Godkjenning krever anonymisert utdrag';
  END IF;

  SELECT review_target_id, experience_cohort INTO v_target, v_cohort
    FROM public.employer_reviews WHERE id = p_review_id;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Fant ikke vurderingen'; END IF;

  UPDATE public.employer_review_texts
     SET publication_status = p_decision::public.employer_review_text_status,
         anonymized_excerpt = CASE WHEN p_decision = 'approved' THEN btrim(p_anonymized_excerpt) ELSE NULL END,
         approved_at = CASE WHEN p_decision = 'approved' THEN now() ELSE NULL END,
         approved_by = CASE WHEN p_decision = 'approved' THEN auth.uid() ELSE NULL END,
         updated_at = now()
   WHERE review_id = p_review_id;

  UPDATE public.employer_review_moderation
     SET manual_decision = p_decision, manual_decided_by = auth.uid(), manual_decided_at = now()
   WHERE review_id = p_review_id;

  INSERT INTO public.employer_review_revisions (review_id, revision_kind, snapshot)
  VALUES (p_review_id, 'moderation', jsonb_build_object('decision', p_decision, 'at', now()));

  PERFORM public.employer_review_refresh_aggregate(v_target, v_cohort);
END;
$$;
REVOKE ALL ON FUNCTION public.employer_review_moderate(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employer_review_moderate(uuid, text, text) TO authenticated;