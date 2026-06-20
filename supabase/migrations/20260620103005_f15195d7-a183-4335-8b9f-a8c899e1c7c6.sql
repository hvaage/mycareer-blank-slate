
-- 1) Fix work_extent / engagement_type projection in list_user_job_opportunities.
--    Pick from any linked source_posting where the value is NOT NULL.
--    Prefer source matching uo.card_source, then link_role='primary'.
CREATE OR REPLACE FUNCTION public.list_user_job_opportunities(p_status text DEFAULT 'all'::text, p_source text DEFAULT 'all'::text)
 RETURNS TABLE(row_kind text, source text, sources text[], user_opportunity_id uuid, listing_status_id uuid, listing_id uuid, canonical_opportunity_id uuid, linkedin_lead_id uuid, status text, is_expired boolean, live_until timestamp with time zone, relevance_score numeric, ai_score numeric, ai_scored_at timestamp with time zone, ai_reasoning text, ai_match_highlights text, ai_concerns text, title text, employer text, location text, work_type text, salary text, salary_min numeric, salary_max numeric, salary_currency text, published_at timestamp with time zone, source_url text, display_url text, raw_url text, identity_fingerprint text, posted_text text, raw_snippet text, source_subject text, source_email_from text, received_at timestamp with time zone, work_extent text, engagement_type text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  filter_status text;
  filter_source text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  filter_status := lower(btrim(coalesce(p_status, 'all')));
  IF filter_status NOT IN ('all','new','saved','applied','all-history') THEN
    filter_status := 'all';
  END IF;
  filter_source := lower(btrim(coalesce(p_source, 'all')));
  IF filter_source NOT IN ('all','nav','careerjet','linkedin') THEN
    filter_source := 'all';
  END IF;

  IF filter_source IN ('all','nav','careerjet') THEN
    RETURN QUERY
    WITH co_src AS (
      SELECT
        osl.canonical_opportunity_id,
        array_agg(DISTINCT sp.source) AS sources
      FROM public.opportunity_source_links osl
      JOIN public.source_postings sp ON sp.id = osl.source_posting_id
      GROUP BY osl.canonical_opportunity_id
    )
    SELECT
      'canonical'::text,
      coalesce(co.primary_source, 'careerjet')::text,
      coalesce(cs.sources, ARRAY[]::text[]),
      uo.id, uo.legacy_listing_status_id, uo.legacy_listing_id, uo.canonical_opportunity_id,
      NULL::uuid,
      uo.status::text,
      (co.live_until IS NOT NULL AND co.live_until > now())::boolean,
      co.live_until,
      uo.relevance_score::numeric, uo.ai_score::numeric, uo.ai_scored_at,
      uo.ai_reasoning, uo.ai_match_highlights, uo.ai_concerns,
      uo.card_title, uo.card_company, uo.card_location, NULL::text,
      uo.card_salary, uo.card_salary_min, uo.card_salary_max, uo.card_salary_currency,
      uo.card_published_at,
      uo.card_display_url, uo.card_display_url, uo.card_raw_url,
      uo.identity_fingerprint,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz,
      (SELECT sp2.work_extent
         FROM public.opportunity_source_links osl2
         JOIN public.source_postings sp2 ON sp2.id = osl2.source_posting_id
         WHERE osl2.canonical_opportunity_id = co.id
           AND sp2.work_extent IS NOT NULL
         ORDER BY (sp2.source = uo.card_source) DESC,
                  (osl2.link_role = 'primary') DESC
         LIMIT 1)::text,
      (SELECT sp2.engagement_type
         FROM public.opportunity_source_links osl2
         JOIN public.source_postings sp2 ON sp2.id = osl2.source_posting_id
         WHERE osl2.canonical_opportunity_id = co.id
           AND sp2.engagement_type IS NOT NULL
         ORDER BY (sp2.source = uo.card_source) DESC,
                  (osl2.link_role = 'primary') DESC
         LIMIT 1)::text
    FROM public.user_opportunities uo
    JOIN public.canonical_opportunities co ON co.id = uo.canonical_opportunity_id
    LEFT JOIN co_src cs ON cs.canonical_opportunity_id = co.id
    WHERE uo.user_id = auth.uid()
      AND (
        filter_status = 'all'         AND uo.status <> 'dismissed'
        OR filter_status = 'all-history'
        OR filter_status = 'new'      AND uo.status = 'new'
        OR filter_status = 'saved'    AND uo.status = 'saved'
        OR filter_status = 'applied'  AND uo.status = 'applied'
      )
      AND (
        filter_source = 'all'
        OR (filter_source = 'nav' AND EXISTS (
              SELECT 1 FROM public.opportunity_source_links osl2
              JOIN public.source_postings sp2 ON sp2.id = osl2.source_posting_id
              WHERE osl2.canonical_opportunity_id = co.id AND sp2.source = 'nav'))
        OR (filter_source = 'careerjet' AND EXISTS (
              SELECT 1 FROM public.opportunity_source_links osl2
              JOIN public.source_postings sp2 ON sp2.id = osl2.source_posting_id
              WHERE osl2.canonical_opportunity_id = co.id AND sp2.source = 'careerjet'))
      )
      AND (
        filter_status = 'all-history'
        OR co.live_until IS NULL
        OR co.live_until > now()
      );
  END IF;

  IF filter_source IN ('all','careerjet') THEN
    RETURN QUERY
    SELECT
      'legacy'::text,
      'careerjet'::text,
      ARRAY['careerjet']::text[],
      NULL::uuid, uj.id, jl.id, NULL::uuid, NULL::uuid,
      uj.status::text,
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
              public.opportunity_fingerprint(jl2.employer, jl2.title, jl2.location)
        )
        AND (
          filter_status = 'all'         AND uj2.status <> 'dismissed'
          OR filter_status = 'all-history'
          OR filter_status = 'new'      AND uj2.status = 'new'
          OR filter_status = 'saved'    AND uj2.status = 'saved'
          OR filter_status = 'applied'  AND uj2.status = 'applied'
        )
      ORDER BY public.opportunity_fingerprint(jl2.employer, jl2.title, jl2.location),
               uj2.updated_at DESC NULLS LAST
    ) uj
    JOIN public.job_listings jl ON jl.id = uj.listing_id;
  END IF;

  IF filter_source IN ('all','linkedin') THEN
    RETURN QUERY
    SELECT
      'linkedin'::text,
      'linkedin'::text,
      ARRAY['linkedin']::text[],
      NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, jl.id,
      jl.status::text,
      false::boolean, NULL::timestamptz,
      NULL::numeric, jl.ai_score::numeric, NULL::timestamptz,
      jl.ai_reasoning, jl.ai_match_highlights, jl.ai_concerns,
      jl.title, jl.company, jl.location, jl.work_type,
      jl.salary_text, NULL::numeric, NULL::numeric, NULL::text,
      jl.received_at, jl.job_url, jl.job_url, jl.job_url,
      NULL::text,
      jl.posted_text, jl.raw_snippet, jl.source_subject, jl.source_email_from, jl.received_at,
      NULL::text, NULL::text
    FROM public.job_leads jl
    WHERE jl.user_id = auth.uid()
      AND (
        filter_status = 'all'         AND jl.status::text <> 'avvist'
        OR filter_status = 'all-history'
        OR filter_status = 'new'      AND jl.status::text = 'ny'
        OR filter_status = 'applied'  AND jl.status::text = 'promotert'
        OR filter_status = 'saved'    AND FALSE
      );
  END IF;
END;
$function$;

-- 2) Lifecycle backfill: NAV canonicals currently in karens window but lacking reliable
--    upstream evidence (no nav_detail anywhere, no reliable chosen_from, no active source)
--    should fall out of the active funnel. Set live_until=now(). Preserve everything else.
WITH co_nav_visible AS (
  SELECT co.id
  FROM public.canonical_opportunities co
  WHERE co.primary_source = 'nav'
    AND co.live_until IS NOT NULL
    AND co.live_until > now()
),
evidence AS (
  SELECT cn.id co_id,
    bool_or(sp.posting_status = 'active') has_active,
    bool_or(sp.raw_payload->'nav_detail' IS NOT NULL) has_detail,
    bool_or(
      (sp.raw_payload #>> '{nav_inactive_event,source_event_at_chosen_from}') IN (
        'incoming.nav_event_modified_at',
        'incoming.date_modified',
        'nav_detail._feed_entry.sistEndret',
        'nav_detail.sistEndret',
        'nav_detail.ad_content.updated',
        'nav_detail.json.updated'
      )
    ) has_reliable_event
  FROM co_nav_visible cn
  LEFT JOIN public.opportunity_source_links osl ON osl.canonical_opportunity_id = cn.id
  LEFT JOIN public.source_postings sp ON sp.id = osl.source_posting_id
  GROUP BY cn.id
)
UPDATE public.canonical_opportunities co
SET live_until = now(),
    updated_at = now()
FROM evidence ev
WHERE co.id = ev.co_id
  AND COALESCE(ev.has_active, false) = false
  AND COALESCE(ev.has_detail, false) = false
  AND COALESCE(ev.has_reliable_event, false) = false;
