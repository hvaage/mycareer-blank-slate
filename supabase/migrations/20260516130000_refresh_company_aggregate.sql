-- App calls refresh_company_aggregate after saving user_company_ratings (employers detail).
-- refresh_company_process_aggregate exists separately for application_process_ratings.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS agg_culture_score numeric,
  ADD COLUMN IF NOT EXISTS agg_leadership_score numeric,
  ADD COLUMN IF NOT EXISTS agg_work_environment_score numeric,
  ADD COLUMN IF NOT EXISTS agg_career_development_score numeric,
  ADD COLUMN IF NOT EXISTS agg_financial_stability_score numeric,
  ADD COLUMN IF NOT EXISTS agg_mission_score numeric,
  ADD COLUMN IF NOT EXISTS agg_overall_score numeric,
  ADD COLUMN IF NOT EXISTS agg_rating_count integer,
  ADD COLUMN IF NOT EXISTS agg_updated_at timestamptz;

CREATE OR REPLACE FUNCTION public.refresh_company_aggregate(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.companies
  SET
    agg_culture_score = (
      SELECT round(avg(culture_score)::numeric, 1)
      FROM public.user_company_ratings
      WHERE company_id = p_company_id
    ),
    agg_leadership_score = (
      SELECT round(avg(leadership_score)::numeric, 1)
      FROM public.user_company_ratings
      WHERE company_id = p_company_id
    ),
    agg_work_environment_score = (
      SELECT round(avg(work_environment_score)::numeric, 1)
      FROM public.user_company_ratings
      WHERE company_id = p_company_id
    ),
    agg_career_development_score = (
      SELECT round(avg(career_development_score)::numeric, 1)
      FROM public.user_company_ratings
      WHERE company_id = p_company_id
    ),
    agg_financial_stability_score = (
      SELECT round(avg(financial_stability_score)::numeric, 1)
      FROM public.user_company_ratings
      WHERE company_id = p_company_id
    ),
    agg_mission_score = (
      SELECT round(avg(mission_score)::numeric, 1)
      FROM public.user_company_ratings
      WHERE company_id = p_company_id
    ),
    agg_overall_score = (
      SELECT round(avg(overall_score)::numeric, 1)
      FROM public.user_company_ratings
      WHERE company_id = p_company_id
    ),
    agg_rating_count = (
      SELECT count(*)::integer
      FROM public.user_company_ratings
      WHERE company_id = p_company_id
    ),
    agg_updated_at = now(),
    updated_at = now()
  WHERE id = p_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_company_aggregate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_company_aggregate(uuid) TO authenticated;

COMMENT ON FUNCTION public.refresh_company_aggregate(uuid) IS
  'Recompute companies agg_* dimension scores from all user_company_ratings for the company. SECURITY DEFINER (companies has SELECT-only RLS for authenticated).';

NOTIFY pgrst, 'reload schema';
