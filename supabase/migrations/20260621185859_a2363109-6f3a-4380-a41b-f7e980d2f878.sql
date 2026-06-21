CREATE OR REPLACE FUNCTION public.nav_sync_vault_secret_status()
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE v_secret text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required' USING ERRCODE = '42501';
  END IF;
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'sync_nav_secret'
   LIMIT 1;
  IF v_secret IS NULL OR length(btrim(v_secret)) = 0 THEN
    RETURN 'missing';
  END IF;
  RETURN 'present';
END $$;

REVOKE ALL ON FUNCTION public.nav_sync_vault_secret_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nav_sync_vault_secret_status() TO authenticated;