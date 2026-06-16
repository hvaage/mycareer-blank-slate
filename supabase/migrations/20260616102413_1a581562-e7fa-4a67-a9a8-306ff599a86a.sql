-- M4-patch: public read access for Arbeidsgiverinnsikt
GRANT SELECT ON public.employer_search_v1 TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.search_employers(
  text, text, text, text, integer, integer, numeric, numeric, text, integer, integer, text, text
) TO anon, authenticated;

-- Statistikk for planneren
ANALYZE reg.enheter;
ANALYZE reg.regnskap;
ANALYZE reg.regnskap_sync_status;
ANALYZE public.companies;

NOTIFY pgrst, 'reload schema';