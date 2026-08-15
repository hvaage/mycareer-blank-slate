CREATE OR REPLACE FUNCTION public.get_user_employers(p_user_id uuid)
 RETURNS TABLE(company_id uuid, source text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT c.id, 'application'::text FROM public.applications a
    JOIN public.companies c ON c.id = a.company_id
    WHERE a.user_id = p_user_id AND a.company_id IS NOT NULL
  UNION
  SELECT DISTINCT ucr.company_id, 'rating'::text FROM public.user_company_ratings ucr
    WHERE ucr.user_id = p_user_id AND ucr.company_id IS NOT NULL
$function$;