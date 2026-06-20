
-- Backfill NAV display_url / card_display_url to canonical ad page format:
--   https://arbeidsplassen.nav.no/stillinger/stilling/{uuid}
-- Source priority for the uuid: nav_detail.uuid → _feed_entry.uuid → source_external_id (when UUID).
-- raw_url / card_raw_url / raw_payload / history are NEVER touched.

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
  WHERE sp.source='nav'
)
UPDATE public.source_postings sp
SET display_url = 'https://arbeidsplassen.nav.no/stillinger/stilling/' || ids.uuid
FROM ids
WHERE sp.id = ids.sp_id
  AND ids.uuid IS NOT NULL
  AND (sp.display_url IS DISTINCT FROM 'https://arbeidsplassen.nav.no/stillinger/stilling/' || ids.uuid);

WITH co_ids AS (
  SELECT
    co.id AS co_id,
    COALESCE(
      NULLIF(sp.raw_payload->'nav_detail'->>'uuid',''),
      NULLIF(sp.raw_payload->'_feed_entry'->>'uuid',''),
      CASE WHEN sp.source_external_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN sp.source_external_id END
    ) AS uuid
  FROM public.canonical_opportunities co
  JOIN public.opportunity_source_links osl ON osl.canonical_opportunity_id = co.id AND osl.link_role='primary'
  JOIN public.source_postings sp ON sp.id = osl.source_posting_id AND sp.source='nav'
  WHERE co.primary_source='nav'
)
UPDATE public.canonical_opportunities co
SET display_url = 'https://arbeidsplassen.nav.no/stillinger/stilling/' || co_ids.uuid
FROM co_ids
WHERE co.id = co_ids.co_id
  AND co_ids.uuid IS NOT NULL
  AND (co.display_url IS DISTINCT FROM 'https://arbeidsplassen.nav.no/stillinger/stilling/' || co_ids.uuid);

UPDATE public.user_opportunities uo
SET card_display_url = co.display_url
FROM public.canonical_opportunities co
WHERE uo.canonical_opportunity_id = co.id
  AND uo.card_source = 'nav'
  AND co.display_url LIKE 'https://arbeidsplassen.nav.no/stillinger/stilling/%'
  AND uo.card_display_url IS DISTINCT FROM co.display_url;
