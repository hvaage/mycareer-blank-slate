DROP FUNCTION IF EXISTS public.network_hide_company(text, uuid, text, text);
DROP FUNCTION IF EXISTS public.network_unhide_company(text);

CREATE OR REPLACE FUNCTION public.network_hide_company(
  p_user_id uuid,
  p_company_key text,
  p_company_id uuid DEFAULT NULL,
  p_company_name text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'missing_user');
  END IF;
  IF coalesce(btrim(p_company_key), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'missing_company_key');
  END IF;
  IF p_company_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.companies c WHERE c.id = p_company_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'company_not_found');
  END IF;

  INSERT INTO public.network_hidden_companies (user_id, company_key, company_id, company_name, reason)
  VALUES (p_user_id, btrim(p_company_key), p_company_id,
          nullif(btrim(coalesce(p_company_name, '')), ''),
          nullif(btrim(coalesce(p_reason, '')), ''))
  ON CONFLICT (user_id, company_key)
  DO UPDATE SET company_id = COALESCE(EXCLUDED.company_id, public.network_hidden_companies.company_id),
                company_name = COALESCE(EXCLUDED.company_name, public.network_hidden_companies.company_name),
                reason = COALESCE(EXCLUDED.reason, public.network_hidden_companies.reason);

  RETURN jsonb_build_object('ok', true, 'company_key', btrim(p_company_key));
END;
$$;

CREATE OR REPLACE FUNCTION public.network_unhide_company(p_user_id uuid, p_company_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'missing_user');
  END IF;

  DELETE FROM public.network_hidden_companies
   WHERE user_id = p_user_id
     AND company_key = btrim(p_company_key);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'restored_count', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.network_hide_company(uuid, text, uuid, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.network_unhide_company(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.network_hide_company(uuid, text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.network_unhide_company(uuid, text) TO service_role;