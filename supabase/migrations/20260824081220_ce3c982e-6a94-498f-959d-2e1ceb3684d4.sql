ALTER TABLE public.job_leads
  ADD COLUMN IF NOT EXISTS screening_status text,
  ADD COLUMN IF NOT EXISTS screening_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS requirement_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS match_score_version text,
  ADD COLUMN IF NOT EXISTS match_scored_model text,
  ADD COLUMN IF NOT EXISTS ai_scored_at timestamptz,
  ADD COLUMN IF NOT EXISTS screening_evaluated_at timestamptz;

ALTER TABLE public.job_match_evaluations
  ADD COLUMN IF NOT EXISTS job_lead_id uuid REFERENCES public.job_leads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS job_match_evaluations_job_lead_id_idx ON public.job_match_evaluations(job_lead_id);

CREATE OR REPLACE FUNCTION public.record_job_match_evaluation(
  p_user_id uuid,
  p_row_kind text,
  p_row_id uuid,
  p_result jsonb,
  p_score_version text,
  p_model text,
  p_profile_input_hash text,
  p_job_input_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text := p_result->>'screening_status';
  v_score numeric;
  v_previous jsonb;
  v_user_opportunity_id uuid;
  v_listing_status_id uuid;
  v_canonical_opportunity_id uuid;
  v_listing_id uuid;
  v_job_lead_id uuid;
  v_now timestamptz := now();
BEGIN
  IF p_user_id IS NULL OR p_row_id IS NULL THEN
    RAISE EXCEPTION 'invalid_row_reference';
  END IF;
  IF p_row_kind NOT IN ('canonical', 'legacy', 'job_leads') THEN
    RAISE EXCEPTION 'invalid_row_kind';
  END IF;
  IF v_status NOT IN ('eligible', 'excluded', 'needs_review') THEN
    RAISE EXCEPTION 'invalid_screening_status';
  END IF;
  IF p_score_version IS NULL OR btrim(p_score_version) = '' THEN
    RAISE EXCEPTION 'invalid_score_version';
  END IF;

  BEGIN
    v_score := (p_result->>'score')::numeric;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_score';
  END;
  IF v_score IS NULL OR v_score < 0 OR v_score > 100 THEN
    RAISE EXCEPTION 'invalid_score';
  END IF;

  IF p_row_kind = 'canonical' THEN
    SELECT
      uo.id,
      uo.canonical_opportunity_id,
      uo.legacy_listing_id,
      jsonb_build_object(
        'screening_status', uo.screening_status,
        'screening_reasons', uo.screening_reasons,
        'requirement_summary', uo.requirement_summary,
        'score_version', uo.match_score_version,
        'model', uo.match_scored_model,
        'score', uo.ai_score,
        'reasoning', uo.ai_reasoning,
        'match_highlights', uo.ai_match_highlights,
        'concerns', uo.ai_concerns,
        'scored_at', uo.ai_scored_at
      )
    INTO v_user_opportunity_id, v_canonical_opportunity_id, v_listing_id, v_previous
    FROM public.user_opportunities uo
    WHERE uo.id = p_row_id AND uo.user_id = p_user_id
    FOR UPDATE;

    IF v_user_opportunity_id IS NULL THEN
      RAISE EXCEPTION 'row_not_found';
    END IF;

    UPDATE public.user_opportunities
    SET screening_status = v_status,
        screening_reasons = coalesce(p_result->'screening_reasons', '[]'::jsonb),
        requirement_summary = coalesce(p_result->'requirement_summary', '{}'::jsonb),
        match_score_version = p_score_version,
        match_scored_model = p_model,
        screening_evaluated_at = v_now,
        ai_score = v_score,
        ai_reasoning = nullif(p_result->>'reasoning', ''),
        ai_match_highlights = nullif(p_result->>'match_highlights', ''),
        ai_concerns = nullif(p_result->>'concerns', ''),
        ai_scored_at = v_now,
        updated_at = v_now
    WHERE id = v_user_opportunity_id AND user_id = p_user_id;
  ELSIF p_row_kind = 'legacy' THEN
    SELECT
      uj.id,
      uj.listing_id,
      jsonb_build_object(
        'screening_status', uj.screening_status,
        'screening_reasons', uj.screening_reasons,
        'requirement_summary', uj.requirement_summary,
        'score_version', uj.match_score_version,
        'model', uj.match_scored_model,
        'score', uj.ai_score,
        'reasoning', uj.ai_reasoning,
        'match_highlights', uj.ai_match_highlights,
        'concerns', uj.ai_concerns,
        'scored_at', uj.ai_scored_at
      )
    INTO v_listing_status_id, v_listing_id, v_previous
    FROM public.user_job_listing_status uj
    WHERE uj.id = p_row_id AND uj.user_id = p_user_id
    FOR UPDATE;

    IF v_listing_status_id IS NULL THEN
      RAISE EXCEPTION 'row_not_found';
    END IF;

    UPDATE public.user_job_listing_status
    SET screening_status = v_status,
        screening_reasons = coalesce(p_result->'screening_reasons', '[]'::jsonb),
        requirement_summary = coalesce(p_result->'requirement_summary', '{}'::jsonb),
        match_score_version = p_score_version,
        match_scored_model = p_model,
        screening_evaluated_at = v_now,
        ai_score = v_score,
        ai_reasoning = nullif(p_result->>'reasoning', ''),
        ai_match_highlights = nullif(p_result->>'match_highlights', ''),
        ai_concerns = nullif(p_result->>'concerns', ''),
        ai_scored_at = v_now,
        updated_at = v_now
    WHERE id = v_listing_status_id AND user_id = p_user_id;
  ELSE
    SELECT
      jl.id,
      jsonb_build_object(
        'screening_status', jl.screening_status,
        'screening_reasons', jl.screening_reasons,
        'requirement_summary', jl.requirement_summary,
        'score_version', jl.match_score_version,
        'model', jl.match_scored_model,
        'score', jl.ai_score,
        'reasoning', jl.ai_reasoning,
        'match_highlights', jl.ai_match_highlights,
        'concerns', jl.ai_concerns,
        'scored_at', jl.ai_scored_at
      )
    INTO v_job_lead_id, v_previous
    FROM public.job_leads jl
    WHERE jl.id = p_row_id AND jl.user_id = p_user_id
    FOR UPDATE;

    IF v_job_lead_id IS NULL THEN
      RAISE EXCEPTION 'row_not_found';
    END IF;

    UPDATE public.job_leads
    SET screening_status = v_status,
        screening_reasons = coalesce(p_result->'screening_reasons', '[]'::jsonb),
        requirement_summary = coalesce(p_result->'requirement_summary', '{}'::jsonb),
        match_score_version = p_score_version,
        match_scored_model = p_model,
        screening_evaluated_at = v_now,
        ai_score = round(v_score)::smallint,
        ai_reasoning = nullif(p_result->>'reasoning', ''),
        ai_match_highlights = nullif(p_result->>'match_highlights', ''),
        ai_concerns = nullif(p_result->>'concerns', ''),
        ai_scored_at = v_now,
        updated_at = v_now
    WHERE id = v_job_lead_id AND user_id = p_user_id;
  END IF;

  INSERT INTO public.job_match_evaluations (
    user_id, row_kind, user_opportunity_id, listing_status_id,
    canonical_opportunity_id, listing_id, job_lead_id, score_version, model,
    screening_status, screening_reasons, requirement_summary, score,
    reasoning, match_highlights, concerns, previous_result,
    profile_input_hash, job_input_hash
  ) VALUES (
    p_user_id, p_row_kind, v_user_opportunity_id, v_listing_status_id,
    v_canonical_opportunity_id, v_listing_id, v_job_lead_id, p_score_version, p_model,
    v_status,
    coalesce(p_result->'screening_reasons', '[]'::jsonb),
    coalesce(p_result->'requirement_summary', '{}'::jsonb),
    v_score,
    nullif(p_result->>'reasoning', ''),
    nullif(p_result->>'match_highlights', ''),
    nullif(p_result->>'concerns', ''),
    coalesce(v_previous, '{}'::jsonb),
    p_profile_input_hash,
    p_job_input_hash
  );

  RETURN jsonb_build_object('ok', true);
END;
$function$