GRANT EXECUTE ON FUNCTION public.get_employer_detail(text) TO anon;

GRANT EXECUTE ON FUNCTION public.search_employers(
  text, text, text, text, integer, integer, numeric, numeric, text, integer, integer, text, text
) TO anon;