ALTER TABLE public.respondent_profile
  ADD COLUMN sectors text[] NOT NULL DEFAULT '{}'::text[];

UPDATE public.respondent_profile
SET sectors = ARRAY[sector]
WHERE sector IS NOT NULL
  AND btrim(sector) <> ''
  AND cardinality(sectors) = 0;

COMMENT ON COLUMN public.respondent_profile.sectors IS
  'One or more primary sectors selected by the anonymous survey respondent; legacy sector remains for backward compatibility.';