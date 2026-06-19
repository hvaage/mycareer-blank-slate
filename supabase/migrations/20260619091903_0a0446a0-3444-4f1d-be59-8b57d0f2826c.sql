CREATE OR REPLACE FUNCTION public.nav_sync_duplicate_external_ids()
RETURNS TABLE(external_id text, count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT sp.source_external_id::text, count(*)::bigint
    FROM public.source_postings sp
    WHERE sp.source = 'nav' AND sp.source_external_id IS NOT NULL
    GROUP BY sp.source_external_id
    HAVING count(*) > 1
    ORDER BY count(*) DESC
    LIMIT 100;
END;
$$;

CREATE OR REPLACE FUNCTION public.nav_sync_distinct_external_count()
RETURNS bigint
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE n bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;
  SELECT count(DISTINCT sp.source_external_id) INTO n
  FROM public.source_postings sp
  WHERE sp.source = 'nav' AND sp.source_external_id IS NOT NULL;
  RETURN COALESCE(n, 0);
END;
$$;