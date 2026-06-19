CREATE OR REPLACE FUNCTION public.nav_sync_count_missing_nav_detail()
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
  SELECT count(*) INTO n
  FROM public.source_postings sp
  WHERE sp.source = 'nav'
    AND sp.posting_status = 'active'
    AND (sp.raw_payload->'nav_detail') IS NULL;
  RETURN COALESCE(n, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.nav_sync_count_missing_nav_detail() TO authenticated;