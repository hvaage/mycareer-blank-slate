DO $$
DECLARE s text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO s
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'network_company_reconciliation_scan';
  EXECUTE replace(s, '''nettverk''', '''unknown''');

  SELECT pg_get_functiondef(p.oid) INTO s
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'network_company_reconciliation_confirm';
  EXECUTE replace(s, '''nettverk''', '''unknown''');
END $$;