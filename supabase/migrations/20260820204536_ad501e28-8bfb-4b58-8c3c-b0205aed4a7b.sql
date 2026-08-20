CREATE OR REPLACE FUNCTION public.linkedin_worker_secret_present()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, vault AS $$
  SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'LINKEDIN_IMPORT_WORKER_SECRET');
$$;

CREATE OR REPLACE FUNCTION public.linkedin_worker_secret_sync(p_secret text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE
  v_existing text;
BEGIN
  IF p_secret IS NULL OR length(p_secret) < 16 THEN
    RAISE EXCEPTION 'invalid_secret';
  END IF;

  SELECT decrypted_secret INTO v_existing
    FROM vault.decrypted_secrets WHERE name = 'LINKEDIN_IMPORT_WORKER_SECRET';

  IF v_existing IS NULL THEN
    PERFORM vault.create_secret(p_secret, 'LINKEDIN_IMPORT_WORKER_SECRET',
      'Delt hemmelighet mellom pg_cron og /api/public/linkedin/worker');
    RETURN true;
  END IF;

  RETURN v_existing = p_secret;
END;
$$;

REVOKE ALL ON FUNCTION public.linkedin_worker_secret_present() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.linkedin_worker_secret_sync(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.linkedin_worker_secret_present() TO service_role;
GRANT EXECUTE ON FUNCTION public.linkedin_worker_secret_sync(text) TO service_role;
