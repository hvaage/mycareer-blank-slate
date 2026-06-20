-- Rev 4 / M5.8 part 1: stillingsomfang, ansettelsesforhold, NAV display-URL backfill,
-- normaliserte ad-felter, RPC-utvidelse.
-- Eiendomsbevarende DROP + CREATE av list_user_job_opportunities.
-- Ingen Careerjet-sync- eller cron-endringer. Ingen sletting.

-- ============================================================
-- A) profiles: preferred_work_extents + preferred_engagement_types
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_work_extents text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS preferred_engagement_types text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_preferred_work_extents_chk;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_preferred_work_extents_chk
  CHECK (
    preferred_work_extents <@ ARRAY['full_time','part_time']::text[]
  );

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_preferred_engagement_types_chk;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_preferred_engagement_types_chk
  CHECK (
    preferred_engagement_types <@ ARRAY['permanent','temporary','project','interim']::text[]
  );

COMMENT ON COLUMN public.profiles.preferred_work_extents IS
  'Stillingsomfang-preferanser. Tom = ingen preferanse (vis alt). Lovlige verdier: full_time, part_time.';
COMMENT ON COLUMN public.profiles.preferred_engagement_types IS
  'Ansettelsesforhold-preferanser. Tom = ingen preferanse. Lovlige verdier: permanent, temporary, project, interim.';

-- ============================================================
-- B) source_postings: work_extent + engagement_type
-- ============================================================
ALTER TABLE public.source_postings
  ADD COLUMN IF NOT EXISTS work_extent text,
  ADD COLUMN IF NOT EXISTS engagement_type text;

ALTER TABLE public.source_postings
  DROP CONSTRAINT IF EXISTS source_postings_work_extent_chk;
ALTER TABLE public.source_postings
  ADD CONSTRAINT source_postings_work_extent_chk
  CHECK (work_extent IS NULL OR work_extent IN ('full_time','part_time'));

ALTER TABLE public.source_postings
  DROP CONSTRAINT IF EXISTS source_postings_engagement_type_chk;
ALTER TABLE public.source_postings
  ADD CONSTRAINT source_postings_engagement_type_chk
  CHECK (engagement_type IS NULL OR engagement_type IN ('permanent','temporary','project','interim'));

CREATE INDEX IF NOT EXISTS idx_source_postings_work_extent
  ON public.source_postings (work_extent) WHERE work_extent IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_source_postings_engagement_type
  ON public.source_postings (engagement_type) WHERE engagement_type IS NOT NULL;

COMMENT ON COLUMN public.source_postings.work_extent IS
  'Normalisert stillingsomfang. Aldri overskrives med null på INACTIVE (bevares fra ACTIVE).';
COMMENT ON COLUMN public.source_postings.engagement_type IS
  'Normalisert ansettelsesforhold. Aldri overskrives med null på INACTIVE (bevares fra ACTIVE).';

-- ============================================================
-- C) NAV display-URL backfill (presentasjons-felt; aldri raw_url eller raw_payload)
--    Bruk nav_detail.uuid -> _feed_entry.uuid -> source_external_id (kun hvis UUID).
--    Format: https://arbeidsplassen.nav.no/stillinger?source=feed&id={uuid}
-- ============================================================
WITH ids AS (
  SELECT
    sp.id AS sp_id,
    COALESCE(
      NULLIF(sp.raw_payload->'nav_detail'->>'uuid',''),
      NULLIF(sp.raw_payload->'_feed_entry'->>'uuid',''),
      CASE WHEN sp.source_external_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN sp.source_external_id END
    ) AS uuid
  FROM public.source_postings sp
  WHERE sp.source = 'nav'
)
UPDATE public.source_postings sp
SET display_url = 'https://arbeidsplassen.nav.no/stillinger?source=feed&id=' || ids.uuid,
    updated_at = now()
FROM ids
WHERE sp.id = ids.sp_id
  AND ids.uuid IS NOT NULL
  AND (sp.display_url IS NULL OR sp.display_url NOT LIKE 'https://arbeidsplassen.nav.no/stillinger?source=feed&id=%');

WITH ids AS (
  SELECT
    co.id AS co_id,
    COALESCE(
      NULLIF(sp.raw_payload->'nav_detail'->>'uuid',''),
      NULLIF(sp.raw_payload->'_feed_entry'->>'uuid',''),
      CASE WHEN sp.source_external_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN sp.source_external_id END
    ) AS uuid
  FROM public.canonical_opportunities co
  JOIN public.opportunity_source_links osl
    ON osl.canonical_opportunity_id = co.id AND osl.link_role = 'primary'
  JOIN public.source_postings sp ON sp.id = osl.source_posting_id
  WHERE sp.source = 'nav'
)
UPDATE public.canonical_opportunities co
SET display_url = 'https://arbeidsplassen.nav.no/stillinger?source=feed&id=' || ids.uuid,
    updated_at = now()
FROM ids
WHERE co.id = ids.co_id
  AND ids.uuid IS NOT NULL
  AND (co.display_url IS NULL OR co.display_url NOT LIKE 'https://arbeidsplassen.nav.no/stillinger?source=feed&id=%');

WITH ids AS (
  SELECT
    uo.id AS uo_id,
    COALESCE(
      NULLIF(sp.raw_payload->'nav_detail'->>'uuid',''),
      NULLIF(sp.raw_payload->'_feed_entry'->>'uuid',''),
      CASE WHEN sp.source_external_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN sp.source_external_id END
    ) AS uuid
  FROM public.user_opportunities uo
  JOIN public.opportunity_source_links osl
    ON osl.canonical_opportunity_id = uo.canonical_opportunity_id AND osl.link_role = 'primary'
  JOIN public.source_postings sp ON sp.id = osl.source_posting_id
  WHERE uo.card_source = 'nav' AND sp.source = 'nav'
)
UPDATE public.user_opportunities uo
SET card_display_url = 'https://arbeidsplassen.nav.no/stillinger?source=feed&id=' || ids.uuid,
    updated_at = now()
FROM ids
WHERE uo.id = ids.uo_id
  AND ids.uuid IS NOT NULL
  AND (uo.card_display_url IS NULL OR uo.card_display_url NOT LIKE 'https://arbeidsplassen.nav.no/stillinger?source=feed&id=%');

-- ============================================================
-- D) NAV extent / engagement backfill (alle nav-rader med nav_detail; også INACTIVE).
--    Stier: nav_detail.ad_content.{extent,engagementtype} ?? nav_detail.json.{extent,engagementtype}
-- ============================================================
UPDATE public.source_postings sp
SET work_extent = CASE lower(COALESCE(
        sp.raw_payload->'nav_detail'->'ad_content'->>'extent',
        sp.raw_payload->'nav_detail'->'json'->>'extent'
      ))
      WHEN 'heltid' THEN 'full_time'
      WHEN 'deltid' THEN 'part_time'
      ELSE NULL END,
    updated_at = now()
WHERE sp.source = 'nav'
  AND sp.work_extent IS NULL
  AND sp.raw_payload->'nav_detail' IS NOT NULL
  AND lower(COALESCE(
        sp.raw_payload->'nav_detail'->'ad_content'->>'extent',
        sp.raw_payload->'nav_detail'->'json'->>'extent'
      )) IN ('heltid','deltid');

UPDATE public.source_postings sp
SET engagement_type = CASE lower(COALESCE(
        sp.raw_payload->'nav_detail'->'ad_content'->>'engagementtype',
        sp.raw_payload->'nav_detail'->'json'->>'engagementtype'
      ))
      WHEN 'fast' THEN 'permanent'
      WHEN 'faste stillinger' THEN 'permanent'
      WHEN 'vikariat' THEN 'temporary'
      WHEN 'engasjement' THEN 'temporary'
      WHEN 'sesong' THEN 'temporary'
      WHEN 'prosjekt' THEN 'project'
      WHEN 'prosjektstilling' THEN 'project'
      WHEN 'interim' THEN 'interim'
      ELSE NULL END,
    updated_at = now()
WHERE sp.source = 'nav'
  AND sp.engagement_type IS NULL
  AND sp.raw_payload->'nav_detail' IS NOT NULL
  AND lower(COALESCE(
        sp.raw_payload->'nav_detail'->'ad_content'->>'engagementtype',
        sp.raw_payload->'nav_detail'->'json'->>'engagementtype'
      )) IN ('fast','faste stillinger','vikariat','engasjement','sesong','prosjekt','prosjektstilling','interim');

-- ============================================================
-- E) list_user_job_opportunities: bevare eier; DROP + CREATE med 2 nye kolonner.
-- ============================================================
DO $migration$
DECLARE
  v_owner text;
BEGIN
  SELECT pg_get_userbyid(p.proowner)::text INTO v_owner
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'list_user_job_opportunities'
    AND pg_get_function_identity_arguments(p.oid) = 'p_status text, p_source text'
  LIMIT 1;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'list_user_job_opportunities(text,text) not found before migration';
  END IF;

  PERFORM set_config('migration.list_uo_owner', v_owner, true);
END
$migration$;

DROP FUNCTION IF EXISTS public.list_user_job_opportunities(text, text);

CREATE OR REPLACE FUNCTION public.list_user_job_opportunities(
  p_status text DEFAULT 'all'::text,
  p_source text DEFAULT 'all'::text
)
RETURNS TABLE(
  row_kind text, source text, sources text[],
  user_opportunity_id uuid, listing_status_id uuid, listing_id uuid,
  canonical_opportunity_id uuid, linkedin_lead_id uuid,
  status text, is_expired boolean, live_until timestamp with time zone,
  relevance_score numeric, ai_score numeric, ai_scored_at timestamp with time zone,
  ai_reasoning text, ai_match_highlights text, ai_concerns text,
  title text, employer text, location text, work_type text,
  salary text, salary_min numeric, salary_max numeric, salary_currency text,
  published_at timestamp with time zone,
  source_url text, display_url text, raw_url text,
  identity_fingerprint text,
  posted_text text, raw_snippet text, source_subject text, source_email_from text,
  received_at timestamp with time zone,
  work_extent text, engagement_type text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
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
        array_agg(DISTINCT sp.source) AS sources,
        bool_and(coalesce(sp.posting_status IN ('expired','removed'), false)) AS all_expired
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
      (SELECT sp2.work_extent FROM public.opportunity_source_links osl2
         JOIN public.source_postings sp2 ON sp2.id = osl2.source_posting_id
         WHERE osl2.canonical_opportunity_id = co.id AND osl2.link_role = 'primary' LIMIT 1)::text,
      (SELECT sp2.engagement_type FROM public.opportunity_source_links osl2
         JOIN public.source_postings sp2 ON sp2.id = osl2.source_posting_id
         WHERE osl2.canonical_opportunity_id = co.id AND osl2.link_role = 'primary' LIMIT 1)::text
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

-- Restore owner exactly
DO $restore$
DECLARE
  v_owner text := current_setting('migration.list_uo_owner', true);
BEGIN
  IF v_owner IS NOT NULL AND v_owner <> '' THEN
    EXECUTE format('ALTER FUNCTION public.list_user_job_opportunities(text, text) OWNER TO %I', v_owner);
  END IF;
END
$restore$;

REVOKE ALL ON FUNCTION public.list_user_job_opportunities(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_user_job_opportunities(text, text) TO authenticated;

COMMENT ON FUNCTION public.list_user_job_opportunities(text, text) IS
  'Brukerens unified jobbtrakt (canonical NAV/Careerjet + legacy Careerjet + LinkedIn). Rev 4: + work_extent, engagement_type fra primary source_posting.';
