CREATE OR REPLACE FUNCTION public.network_set_company_relationship(p_user_id uuid, p_company_id uuid, p_status text DEFAULT NULL::text, p_priority text DEFAULT NULL::text, p_company_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_row public.user_company_relationships%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'missing_arguments');
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN
     ('following','target','active_dialogue','applied','former_employer','paused') THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_status');
  END IF;

  IF p_priority IS NOT NULL AND p_priority NOT IN ('low','normal','high') THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_priority');
  END IF;

  SELECT * INTO v_row
    FROM public.user_company_relationships
   WHERE user_id = p_user_id
     AND company_id = p_company_id
   LIMIT 1;

  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id) THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'company_not_found');
    END IF;

    INSERT INTO public.user_company_relationships
      (user_id, company_id, company_name_user, relationship_kind, status, priority, source_system)
    VALUES
      (p_user_id, p_company_id, p_company_name, 'other', p_status, p_priority, 'user_input')
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.user_company_relationships
       SET status = p_status,
           priority = p_priority,
           updated_at = now()
     WHERE id = v_row.id
       AND user_id = p_user_id
    RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'relationship_id', v_row.id,
    'status', v_row.status,
    'priority', v_row.priority
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.network_set_company_relationship(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.network_set_company_relationship(uuid, uuid, text, text, text) TO service_role;