DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO d
  FROM pg_proc WHERE proname = 'network_company_reconciliation_scan' LIMIT 1;
  d := replace(d, '''nettverk''', '''unknown''');
  EXECUTE d;
END $$;

REVOKE ALL ON public.source_company_resolutions FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.source_company_resolution_upsert(text, text, text, text, jsonb, timestamptz) FROM anon, authenticated;
GRANT ALL ON public.source_company_resolutions TO service_role;