-- Job Match V2: separate hard screening from scoring and retain every
-- replacement evaluation. This migration is additive and performs no rescore.

ALTER TABLE public.user_opportunities
  ADD COLUMN IF NOT EXISTS screening_status text,
  ADD COLUMN IF NOT EXISTS screening_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS requirement_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS match_score_version text,
  ADD COLUMN IF NOT EXISTS match_scored_model text,
  ADD COLUMN IF NOT EXISTS screening_evaluated_at timestamptz;

ALTER TABLE public.user_job_listing_status
  ADD COLUMN IF NOT EXISTS screening_status text,
  ADD COLUMN IF NOT EXISTS screening_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS requirement_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS match_score_version text,
  ADD COLUMN IF NOT EXISTS match_scored_model text,
  ADD COLUMN IF NOT EXISTS screening_evaluated_at timestamptz;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_opportunities_screening_status_chk'
      AND conrelid = 'public.user_opportunities'::regclass
  ) THEN
    ALTER TABLE public.user_opportunities
      ADD CONSTRAINT user_opportunities_screening_status_chk
      CHECK (screening_status IS NULL OR screening_status IN ('eligible', 'excluded', 'needs_review'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_job_listing_status_screening_status_chk'
      AND conrelid = 'public.user_job_listing_status'::regclass
  ) THEN
    ALTER TABLE public.user_job_listing_status
      ADD CONSTRAINT user_job_listing_status_screening_status_chk
      CHECK (screening_status IS NULL OR screening_status IN ('eligible', 'excluded', 'needs_review'));
  END IF;
END;
$constraints$;

CREATE INDEX IF NOT EXISTS idx_user_opportunities_screening
  ON public.user_opportunities (user_id, screening_status, match_score_version, status);

CREATE INDEX IF NOT EXISTS idx_user_job_listing_status_screening
  ON public.user_job_listing_status (user_id, screening_status, match_score_version, status);

ALTER TABLE public.opportunity_requirement_atoms
  ADD COLUMN IF NOT EXISTS requirement_level text,
  ADD COLUMN IF NOT EXISTS evidence_excerpt text,
  ADD COLUMN IF NOT EXISTS parser_version text;

DO $requirement_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'opportunity_requirement_atoms_level_chk'
      AND conrelid = 'public.opportunity_requirement_atoms'::regclass
  ) THEN
    ALTER TABLE public.opportunity_requirement_atoms
      ADD CONSTRAINT opportunity_requirement_atoms_level_chk
      CHECK (requirement_level IS NULL OR requirement_level IN ('mandatory', 'preferred', 'context'));
  END IF;
END;
$requirement_constraint$;

CREATE TABLE IF NOT EXISTS public.job_match_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  row_kind text NOT NULL CHECK (row_kind IN ('canonical', 'legacy')),
  user_opportunity_id uuid REFERENCES public.user_opportunities (id) ON DELETE CASCADE,
  listing_status_id uuid REFERENCES public.user_job_listing_status (id) ON DELETE CASCADE,
  canonical_opportunity_id uuid REFERENCES public.canonical_opportunities (id) ON DELETE SET NULL,
  listing_id uuid REFERENCES public.job_listings (id) ON DELETE SET NULL,
  score_version text NOT NULL,
  model text,
  screening_status text NOT NULL
    CHECK (screening_status IN ('eligible', 'excluded', 'needs_review')),
  screening_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  requirement_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  score numeric CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  reasoning text,
  match_highlights text,
  concerns text,
  previous_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  profile_input_hash text,
  job_input_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_match_evaluations_row_ref_chk CHECK (
    (row_kind = 'canonical' AND user_opportunity_id IS NOT NULL)
    OR (row_kind = 'legacy' AND listing_status_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_job_match_evaluations_user_created
  ON public.job_match_evaluations (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_match_evaluations_user_opportunity
  ON public.job_match_evaluations (user_opportunity_id, created_at DESC)
  WHERE user_opportunity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_job_match_evaluations_listing_status
  ON public.job_match_evaluations (listing_status_id, created_at DESC)
  WHERE listing_status_id IS NOT NULL;

ALTER TABLE public.job_match_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_match_evaluations_select_own
  ON public.job_match_evaluations;

CREATE POLICY job_match_evaluations_select_own
  ON public.job_match_evaluations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.job_match_evaluations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.job_match_evaluations TO authenticated;
GRANT SELECT, INSERT ON public.job_match_evaluations TO service_role;

COMMENT ON TABLE public.job_match_evaluations IS
  'Append-only history of versioned job screening and scoring results. Application code only inserts.';

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
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_status text := p_result->>'screening_status';
  v_score numeric;
  v_previous jsonb;
  v_user_opportunity_id uuid;
  v_listing_status_id uuid;
  v_canonical_opportunity_id uuid;
  v_listing_id uuid;
  v_now timestamptz := now();
BEGIN
  IF p_user_id IS NULL OR p_row_id IS NULL THEN
    RAISE EXCEPTION 'invalid_row_reference';
  END IF;
  IF p_row_kind NOT IN ('canonical', 'legacy') THEN
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
  ELSE
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
  END IF;

  INSERT INTO public.job_match_evaluations (
    user_id, row_kind, user_opportunity_id, listing_status_id,
    canonical_opportunity_id, listing_id, score_version, model,
    screening_status, screening_reasons, requirement_summary, score,
    reasoning, match_highlights, concerns, previous_result,
    profile_input_hash, job_input_hash
  ) VALUES (
    p_user_id, p_row_kind, v_user_opportunity_id, v_listing_status_id,
    v_canonical_opportunity_id, v_listing_id, p_score_version, p_model,
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
$function$;

REVOKE ALL ON FUNCTION public.record_job_match_evaluation(uuid, text, uuid, jsonb, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_job_match_evaluation(uuid, text, uuid, jsonb, text, text, text, text)
  TO service_role;
