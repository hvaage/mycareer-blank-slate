-- Per-bruker matching mot speilet. Ingen eksterne kall, ingen skriving til
-- source_postings/canonical_opportunities — kun kobling i user_opportunities.
CREATE OR REPLACE FUNCTION public.match_user_opportunities_from_mirror(
  p_sources text[] DEFAULT ARRAY['careerjet','nav'],
  p_max_age_days integer DEFAULT 60,
  p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_cutoff timestamptz := now() - make_interval(days => greatest(p_max_age_days, 1));
  v_keywords text[];
  v_locations text[];
  v_scanned integer := 0;
  v_inserted integer := 0;
  v_new_ids uuid[] := '{}';
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT
    coalesce(
      nullif(
        array(
          SELECT lower(btrim(k))
          FROM unnest(
            string_to_array(coalesce(p.job_search_keywords, ''), ',')
            || coalesce(p.target_roles, ARRAY[]::text[])
            || CASE WHEN p.target_role IS NULL THEN ARRAY[]::text[] ELSE ARRAY[p.target_role] END
          ) AS k
          WHERE btrim(k) <> ''
        ),
        ARRAY[]::text[]
      ),
      ARRAY[]::text[]
    ),
    coalesce(
      array(
        SELECT lower(btrim(split_part(l, '(', 1)))
        FROM unnest(
          coalesce(p.preferred_locations, ARRAY[]::text[])
          || CASE WHEN p.target_city IS NULL THEN ARRAY[]::text[] ELSE ARRAY[p.target_city] END
          || CASE WHEN p.target_region IS NULL THEN ARRAY[]::text[] ELSE ARRAY[p.target_region] END
        ) AS l
        WHERE btrim(l) <> ''
      ),
      ARRAY[]::text[]
    )
  INTO v_keywords, v_locations
  FROM public.profiles p
  WHERE p.id = v_user;

  IF v_keywords IS NULL OR array_length(v_keywords, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_keywords',
                              'scanned', 0, 'matched', 0);
  END IF;

  WITH kandidater AS (
    SELECT DISTINCT ON (co.id)
      co.id,
      co.identity_fingerprint,
      co.display_title,
      co.display_company,
      co.display_location,
      co.display_url,
      sp.source,
      sp.published_at
    FROM public.canonical_opportunities co
    JOIN public.opportunity_source_links l ON l.canonical_opportunity_id = co.id
    JOIN public.source_postings sp ON sp.id = l.source_posting_id
    WHERE sp.source = ANY (p_sources)
      AND sp.posting_status = 'active'
      AND public._careerjet_is_visible(sp.identity_role, sp.identity_superseded_by_source_posting_id)
      AND sp.published_at IS NOT NULL
      AND sp.published_at >= v_cutoff
      AND (co.live_until IS NULL OR co.live_until > now())
      AND EXISTS (
        SELECT 1 FROM unnest(v_keywords) k
        WHERE lower(coalesce(co.display_title, '')) LIKE '%' || k || '%'
      )
      AND (
        array_length(v_locations, 1) IS NULL
        OR EXISTS (
          SELECT 1 FROM unnest(v_locations) loc
          WHERE lower(coalesce(co.display_location, '')) LIKE '%' || btrim(loc) || '%'
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.user_opportunities uo
        WHERE uo.user_id = v_user AND uo.canonical_opportunity_id = co.id
      )
    ORDER BY co.id, sp.published_at DESC
  ),
  begrenset AS (
    SELECT * FROM kandidater ORDER BY published_at DESC LIMIT greatest(p_limit, 1)
  ),
  innsatt AS (
    INSERT INTO public.user_opportunities (
      user_id, canonical_opportunity_id, identity_fingerprint, status,
      card_title, card_company, card_location, card_display_url, card_raw_url,
      card_source, card_published_at
    )
    SELECT v_user, b.id, b.identity_fingerprint, 'new',
           b.display_title, b.display_company, b.display_location,
           b.display_url, b.display_url, b.source, b.published_at
    FROM begrenset b
    ON CONFLICT (user_id, canonical_opportunity_id) DO NOTHING
    RETURNING id
  )
  SELECT coalesce(array_agg(id), '{}'), count(*)
    INTO v_new_ids, v_inserted
  FROM innsatt;

  RETURN jsonb_build_object(
    'ok', true,
    'matched', v_inserted,
    'new_ids', to_jsonb(v_new_ids),
    'cutoff', v_cutoff,
    'keywords', to_jsonb(v_keywords),
    'locations', to_jsonb(v_locations)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.match_user_opportunities_from_mirror(text[], integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_user_opportunities_from_mirror(text[], integer, integer) TO authenticated, service_role;