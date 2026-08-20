DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'linkedin\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    IF t <> 'linkedin_storage_delete_queue' THEN
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    END IF;
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;