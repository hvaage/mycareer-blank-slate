-- M5.8.C: Split dedup RLS policies. SELECT keeps system-row + own-row visibility;
-- INSERT/UPDATE/DELETE for authenticated require auth.uid() = user_id (no NULL writes).

BEGIN;

DROP POLICY IF EXISTS opportunity_dedup_candidates_own ON public.opportunity_dedup_candidates;
DROP POLICY IF EXISTS opportunity_dedup_decisions_own  ON public.opportunity_dedup_decisions;

-- Candidates
CREATE POLICY opportunity_dedup_candidates_select
  ON public.opportunity_dedup_candidates
  FOR SELECT TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY opportunity_dedup_candidates_insert
  ON public.opportunity_dedup_candidates
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY opportunity_dedup_candidates_update
  ON public.opportunity_dedup_candidates
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY opportunity_dedup_candidates_delete
  ON public.opportunity_dedup_candidates
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Decisions
CREATE POLICY opportunity_dedup_decisions_select
  ON public.opportunity_dedup_decisions
  FOR SELECT TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY opportunity_dedup_decisions_insert
  ON public.opportunity_dedup_decisions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY opportunity_dedup_decisions_update
  ON public.opportunity_dedup_decisions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY opportunity_dedup_decisions_delete
  ON public.opportunity_dedup_decisions
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Reset the 4 NAV test rows for hvaage@gmail.com that received score 0
-- during the documented acceptance test, so they become uvurdert again.
-- Row with score 15 is intentionally left untouched. user_id used as guard.
UPDATE public.user_opportunities
SET ai_score = NULL,
    ai_scored_at = NULL,
    ai_reasoning = NULL,
    ai_match_highlights = NULL,
    ai_concerns = NULL,
    updated_at = now()
WHERE user_id = '8103b452-0a27-46b0-a204-e2d9db34ec22'
  AND id IN (
    'c1b3c94e-beb9-4b7b-a44a-77c2a3e0ac88',
    '1ed309ff-ff86-4f60-955e-069bf0f8d8e3',
    'f3f73a46-75e9-4e30-a263-1d20d3940a50',
    '87e50b60-9bc0-437c-8156-135a554f6552'
  )
  AND ai_score = 0;

COMMIT;