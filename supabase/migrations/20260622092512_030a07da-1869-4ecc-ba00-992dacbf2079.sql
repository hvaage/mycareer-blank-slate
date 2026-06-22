-- A5 NULL-safe consumer filter for Careerjet superseded rows.
-- Predicate: identity_role IS DISTINCT FROM 'superseded'
--            AND identity_superseded_by_source_posting_id IS NULL
-- Legacy rows have identity_role=NULL and must remain visible.

-- 1. IMMUTABLE helper used in all consumer predicates (and index)
CREATE OR REPLACE FUNCTION public._careerjet_is_visible(
  p_identity_role text,
  p_superseded_by uuid
) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT (p_identity_role IS DISTINCT FROM 'superseded')
     AND (p_superseded_by IS NULL)
$$;

-- 2. Partial index supporting the predicate on careerjet
CREATE INDEX IF NOT EXISTS idx_source_postings_careerjet_visible
  ON public.source_postings (source, posting_status, last_seen_at)
  WHERE source = 'careerjet'
    AND identity_role IS DISTINCT FROM 'superseded'
    AND identity_superseded_by_source_posting_id IS NULL;

-- 3. mark_stale_careerjet_postings — only mark visible (non-superseded) rows
CREATE OR REPLACE FUNCTION public.mark_stale_careerjet_postings(p_days integer DEFAULT 7)
 RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_count int;
BEGIN
  WITH expired AS (
    UPDATE public.source_postings sp
    SET posting_status = 'expired',
        expired_at = COALESCE(sp.expired_at, now()),
        raw_payload = COALESCE(sp.raw_payload, '{}'::jsonb)
          || jsonb_build_object(
            'careerjet_lifecycle_events',
            COALESCE(sp.raw_payload->'careerjet_lifecycle_events','[]'::jsonb)
              || jsonb_build_array(jsonb_build_object(
                'event','expired_by_stale','at', now(),'days', p_days
              ))
          ),
        updated_at = now()
    WHERE sp.source = 'careerjet'
      AND sp.posting_status = 'active'
      AND sp.identity_role IS DISTINCT FROM 'superseded'
      AND sp.identity_superseded_by_source_posting_id IS NULL
      AND sp.last_seen_at IS NOT NULL
      AND sp.last_seen_at < now() - (p_days || ' days')::interval
    RETURNING sp.id
  )
  SELECT count(*) INTO v_count FROM expired;
  RETURN COALESCE(v_count, 0);
END; $function$;

-- 4. Admin stats: distinct external count
CREATE OR REPLACE FUNCTION public.careerjet_sync_distinct_external_count()
 RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public','pg_temp'
AS $function$
DECLARE n bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE='42501';
  END IF;
  SELECT count(DISTINCT sp.source_external_id) INTO n
  FROM public.source_postings sp
  WHERE sp.source='careerjet'
    AND sp.source_external_id IS NOT NULL
    AND sp.identity_role IS DISTINCT FROM 'superseded'
    AND sp.identity_superseded_by_source_posting_id IS NULL;
  RETURN COALESCE(n,0);
END; $function$;

-- 5. Admin stats: duplicate external ids
CREATE OR REPLACE FUNCTION public.careerjet_sync_duplicate_external_ids()
 RETURNS TABLE(external_id text, count bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
    SELECT sp.source_external_id::text, count(*)::bigint
    FROM public.source_postings sp
    WHERE sp.source='careerjet'
      AND sp.source_external_id IS NOT NULL
      AND sp.identity_role IS DISTINCT FROM 'superseded'
      AND sp.identity_superseded_by_source_posting_id IS NULL
    GROUP BY sp.source_external_id HAVING count(*) > 1
    ORDER BY count(*) DESC LIMIT 100;
END; $function$;

-- 6. Admin stats: missing raw_payload
CREATE OR REPLACE FUNCTION public.careerjet_sync_count_missing_raw_payload()
 RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public','pg_temp'
AS $function$
DECLARE n bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE='42501';
  END IF;
  SELECT count(*) INTO n FROM public.source_postings sp
  WHERE sp.source='careerjet' AND sp.posting_status='active'
    AND sp.identity_role IS DISTINCT FROM 'superseded'
    AND sp.identity_superseded_by_source_posting_id IS NULL
    AND sp.raw_payload IS NULL;
  RETURN COALESCE(n,0);
END; $function$;

-- 7. Admin stats: external id prefix counts
CREATE OR REPLACE FUNCTION public.careerjet_sync_external_id_prefix_counts()
 RETURNS TABLE(prefix text, count bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
    SELECT CASE
        WHEN sp.source_external_id LIKE 'cj_id_%' THEN 'cj_id_'
        WHEN sp.source_external_id LIKE 'cj_url_%' THEN 'cj_url_'
        WHEN sp.source_external_id LIKE 'cj_fp_%' THEN 'cj_fp_'
        WHEN sp.source_external_id LIKE 'cj_thr_%' THEN 'cj_thr_'
        ELSE 'other' END AS prefix,
      count(*)::bigint
    FROM public.source_postings sp
    WHERE sp.source='careerjet'
      AND sp.identity_role IS DISTINCT FROM 'superseded'
      AND sp.identity_superseded_by_source_posting_id IS NULL
    GROUP BY 1 ORDER BY 2 DESC;
END; $function$;

-- 8. Admin stats: last_seen distribution
CREATE OR REPLACE FUNCTION public.careerjet_sync_last_seen_stats()
 RETURNS TABLE(min_last_seen timestamptz, max_last_seen timestamptz,
               median_last_seen timestamptz, active_count bigint, expired_count bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
    SELECT
      min(sp.last_seen_at),
      max(sp.last_seen_at),
      (percentile_cont(0.5) WITHIN GROUP (ORDER BY sp.last_seen_at))::timestamptz,
      count(*) FILTER (WHERE sp.posting_status='active')::bigint,
      count(*) FILTER (WHERE sp.posting_status IN ('expired','removed'))::bigint
    FROM public.source_postings sp
    WHERE sp.source='careerjet'
      AND sp.identity_role IS DISTINCT FROM 'superseded'
      AND sp.identity_superseded_by_source_posting_id IS NULL;
END; $function$;

-- 9. list_user_job_opportunities — exclude superseded source_postings from
--    presence checks and attribute lookups; do NOT touch user_opportunities rows.
CREATE OR REPLACE FUNCTION public.list_user_job_opportunities(
  p_status text DEFAULT 'all'::text, p_source text DEFAULT 'all'::text)
 RETURNS TABLE(row_kind text, source text, sources text[],
   user_opportunity_id uuid, listing_status_id uuid, listing_id uuid,
   canonical_opportunity_id uuid, linkedin_lead_id uuid, status text,
   is_expired boolean, live_until timestamptz, relevance_score numeric,
   ai_score numeric, ai_scored_at timestamptz, ai_reasoning text,
   ai_match_highlights text, ai_concerns text, title text, employer text,
   location text, work_type text, salary text, salary_min numeric,
   salary_max numeric, salary_currency text, published_at timestamptz,
   source_url text, display_url text, raw_url text, identity_fingerprint text,
   posted_text text, raw_snippet text, source_subject text,
   source_email_from text, received_at timestamptz, work_extent text,
   engagement_type text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE filter_status text; filter_source text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  filter_status := lower(btrim(coalesce(p_status,'all')));
  IF filter_status NOT IN ('all','new','saved','applied','all-history') THEN filter_status:='all'; END IF;
  filter_source := lower(btrim(coalesce(p_source,'all')));
  IF filter_source NOT IN ('all','nav','careerjet','linkedin') THEN filter_source:='all'; END IF;

  IF filter_source IN ('all','nav','careerjet') THEN
    RETURN QUERY
    WITH co_src AS (
      SELECT osl.canonical_opportunity_id, array_agg(DISTINCT sp.source) AS sources
      FROM public.opportunity_source_links osl
      JOIN public.source_postings sp ON sp.id = osl.source_posting_id
      WHERE sp.source <> 'careerjet'
         OR (sp.identity_role IS DISTINCT FROM 'superseded'
             AND sp.identity_superseded_by_source_posting_id IS NULL)
      GROUP BY osl.canonical_opportunity_id
    )
    SELECT 'canonical'::text, coalesce(co.primary_source,'careerjet')::text,
      coalesce(cs.sources, ARRAY[]::text[]),
      uo.id, uo.legacy_listing_status_id, uo.legacy_listing_id, uo.canonical_opportunity_id,
      NULL::uuid, uo.status::text,
      (co.live_until IS NOT NULL AND co.live_until > now())::boolean, co.live_until,
      uo.relevance_score::numeric, uo.ai_score::numeric, uo.ai_scored_at,
      uo.ai_reasoning, uo.ai_match_highlights, uo.ai_concerns,
      uo.card_title, uo.card_company, uo.card_location, NULL::text,
      uo.card_salary, uo.card_salary_min, uo.card_salary_max, uo.card_salary_currency,
      uo.card_published_at, uo.card_display_url, uo.card_display_url, uo.card_raw_url,
      uo.identity_fingerprint,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz,
      (SELECT sp2.work_extent FROM public.opportunity_source_links osl2
         JOIN public.source_postings sp2 ON sp2.id = osl2.source_posting_id
         WHERE osl2.canonical_opportunity_id = co.id AND sp2.work_extent IS NOT NULL
           AND (sp2.source <> 'careerjet'
                OR (sp2.identity_role IS DISTINCT FROM 'superseded'
                    AND sp2.identity_superseded_by_source_posting_id IS NULL))
         ORDER BY (sp2.source = uo.card_source) DESC,
                  (osl2.link_role = 'primary') DESC LIMIT 1)::text,
      (SELECT sp2.engagement_type FROM public.opportunity_source_links osl2
         JOIN public.source_postings sp2 ON sp2.id = osl2.source_posting_id
         WHERE osl2.canonical_opportunity_id = co.id AND sp2.engagement_type IS NOT NULL
           AND (sp2.source <> 'careerjet'
                OR (sp2.identity_role IS DISTINCT FROM 'superseded'
                    AND sp2.identity_superseded_by_source_posting_id IS NULL))
         ORDER BY (sp2.source = uo.card_source) DESC,
                  (osl2.link_role = 'primary') DESC LIMIT 1)::text
    FROM public.user_opportunities uo
    JOIN public.canonical_opportunities co ON co.id = uo.canonical_opportunity_id
    LEFT JOIN co_src cs ON cs.canonical_opportunity_id = co.id
    WHERE uo.user_id = auth.uid()
      AND (filter_status='all' AND uo.status<>'dismissed'
        OR filter_status='all-history'
        OR filter_status='new' AND uo.status='new'
        OR filter_status='saved' AND uo.status='saved'
        OR filter_status='applied' AND uo.status='applied')
      AND (filter_source='all'
        OR (filter_source='nav' AND EXISTS (
            SELECT 1 FROM public.opportunity_source_links osl2
            JOIN public.source_postings sp2 ON sp2.id=osl2.source_posting_id
            WHERE osl2.canonical_opportunity_id=co.id AND sp2.source='nav'))
        OR (filter_source='careerjet' AND EXISTS (
            SELECT 1 FROM public.opportunity_source_links osl2
            JOIN public.source_postings sp2 ON sp2.id=osl2.source_posting_id
            WHERE osl2.canonical_opportunity_id=co.id AND sp2.source='careerjet'
              AND sp2.identity_role IS DISTINCT FROM 'superseded'
              AND sp2.identity_superseded_by_source_posting_id IS NULL)))
      AND (filter_status='all-history' OR co.live_until IS NULL OR co.live_until > now());
  END IF;

  IF filter_source IN ('all','careerjet') THEN
    RETURN QUERY
    SELECT 'legacy'::text, 'careerjet'::text, ARRAY['careerjet']::text[],
      NULL::uuid, uj.id, jl.id, NULL::uuid, NULL::uuid, uj.status::text,
      false::boolean, NULL::timestamptz,
      uj.relevance_score::numeric, uj.ai_score::numeric, uj.ai_scored_at,
      uj.ai_reasoning, uj.ai_match_highlights, uj.ai_concerns,
      jl.title, jl.employer, jl.location, NULL::text,
      jl.salary, jl.salary_min, jl.salary_max, jl.salary_currency,
      jl.published_at, jl.source_url, jl.source_url, jl.source_url,
      public.opportunity_fingerprint(jl.employer, jl.title, jl.location),
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz,
      NULL::text, NULL::text
    FROM (
      SELECT DISTINCT ON (public.opportunity_fingerprint(jl2.employer, jl2.title, jl2.location))
        uj2.id, uj2.user_id, uj2.status, uj2.relevance_score, uj2.ai_score, uj2.ai_scored_at,
        uj2.ai_reasoning, uj2.ai_match_highlights, uj2.ai_concerns, uj2.listing_id, uj2.updated_at
      FROM public.user_job_listing_status uj2
      JOIN public.job_listings jl2 ON jl2.id = uj2.listing_id
      WHERE uj2.user_id = auth.uid() AND jl2.source = 'careerjet'
        AND NOT EXISTS (
          SELECT 1 FROM public.user_opportunities uo2
          WHERE uo2.user_id = auth.uid()
            AND uo2.identity_fingerprint =
              public.opportunity_fingerprint(jl2.employer, jl2.title, jl2.location))
        AND (filter_status='all' AND uj2.status<>'dismissed'
          OR filter_status='all-history'
          OR filter_status='new' AND uj2.status='new'
          OR filter_status='saved' AND uj2.status='saved'
          OR filter_status='applied' AND uj2.status='applied')
      ORDER BY public.opportunity_fingerprint(jl2.employer, jl2.title, jl2.location),
               uj2.updated_at DESC NULLS LAST
    ) uj JOIN public.job_listings jl ON jl.id = uj.listing_id;
  END IF;

  IF filter_source IN ('all','linkedin') THEN
    RETURN QUERY
    SELECT 'linkedin'::text, 'linkedin'::text, ARRAY['linkedin']::text[],
      NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, jl.id, jl.status::text,
      false::boolean, NULL::timestamptz,
      NULL::numeric, jl.ai_score::numeric, NULL::timestamptz,
      jl.ai_reasoning, jl.ai_match_highlights, jl.ai_concerns,
      jl.title, jl.company, jl.location, jl.work_type, NULL::text, NULL::numeric,
      NULL::numeric, NULL::text, jl.published_at, jl.source_url, jl.source_url, jl.source_url,
      public.opportunity_fingerprint(jl.company, jl.title, jl.location),
      jl.posted_text, jl.raw_snippet, jl.source_subject, jl.source_email_from, jl.received_at,
      NULL::text, NULL::text
    FROM public.linkedin_leads jl
    WHERE jl.user_id = auth.uid()
      AND (filter_status='all' AND jl.status<>'dismissed'
        OR filter_status='all-history'
        OR filter_status='new' AND jl.status='new'
        OR filter_status='saved' AND jl.status='saved'
        OR filter_status='applied' AND jl.status='applied');
  END IF;
END; $function$;