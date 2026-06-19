
-- Backfill NAV URLs to the public arbeidsplassen URL (browser-openable),
-- replacing the feed API URL that requires auth and returns 401.
UPDATE public.source_postings
SET raw_url = 'https://arbeidsplassen.nav.no/stillinger/stilling/' || source_external_id,
    display_url = 'https://arbeidsplassen.nav.no/stillinger/stilling/' || source_external_id
WHERE source = 'nav'
  AND (raw_url LIKE '%pam-stilling-feed.nav.no%' OR display_url LIKE '%pam-stilling-feed.nav.no%');

UPDATE public.canonical_opportunities co
SET display_url = 'https://arbeidsplassen.nav.no/stillinger/stilling/' || sp.source_external_id
FROM public.opportunity_source_links osl
JOIN public.source_postings sp ON sp.id = osl.source_posting_id
WHERE osl.canonical_opportunity_id = co.id
  AND sp.source = 'nav'
  AND co.primary_source = 'nav'
  AND co.display_url LIKE '%pam-stilling-feed.nav.no%';

UPDATE public.user_opportunities uo
SET card_display_url = co.display_url,
    card_raw_url = co.display_url
FROM public.canonical_opportunities co
WHERE uo.canonical_opportunity_id = co.id
  AND co.primary_source = 'nav'
  AND (uo.card_display_url LIKE '%pam-stilling-feed.nav.no%'
       OR uo.card_raw_url LIKE '%pam-stilling-feed.nav.no%');
