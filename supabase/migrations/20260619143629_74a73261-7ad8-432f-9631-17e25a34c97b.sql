CREATE OR REPLACE FUNCTION public.rotate_sync_careerjet_secret(p_new_secret text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_new_secret IS NULL OR length(btrim(p_new_secret)) < 16 THEN
    RAISE EXCEPTION 'new secret too short';
  END IF;
  SELECT id INTO v_id FROM vault.secrets WHERE name = 'sync_careerjet_secret' LIMIT 1;
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_new_secret, 'sync_careerjet_secret', 'Shared secret for careerjet sync cron');
    RETURN 'created';
  ELSE
    PERFORM vault.update_secret(v_id, p_new_secret, 'sync_careerjet_secret', 'Shared secret for careerjet sync cron');
    RETURN 'updated';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_sync_careerjet_secret(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rotate_sync_careerjet_secret(text) TO postgres, service_role, sandbox_exec;