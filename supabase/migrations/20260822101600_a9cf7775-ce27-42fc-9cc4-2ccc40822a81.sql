CREATE OR REPLACE FUNCTION public.network_promote_batch_person_contacts(p_user_id uuid, p_batch_id uuid, p_item_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_batch public.linkedin_network_reconciliation_batches%ROWTYPE;
  v_item RECORD;
  v_contact_id uuid;
  v_connected date;
  v_created integer := 0;
  v_skipped integer := 0;
BEGIN
  IF p_user_id IS NULL OR p_batch_id IS NULL OR p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'missing_arguments');
  END IF;

  IF array_length(p_item_ids, 1) > 5000 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'too_many_items');
  END IF;

  SELECT * INTO v_batch
    FROM public.linkedin_network_reconciliation_batches
   WHERE id = p_batch_id
     AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'batch_not_found');
  END IF;

  IF v_batch.status <> 'ready' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'batch_not_ready');
  END IF;

  FOR v_item IN
    SELECT bi.id,
           bi.staging_record_id,
           ns.full_name,
           ns.company,
           ns.position,
           ns.connected_on,
           ns.profile_url
      FROM public.linkedin_network_reconciliation_batch_items bi
      JOIN public.linkedin_network_staging ns
        ON ns.staging_record_id = bi.staging_record_id
       AND ns.user_id = bi.user_id
     WHERE bi.id = ANY(p_item_ids)
       AND bi.batch_id = p_batch_id
       AND bi.user_id = p_user_id
       AND bi.category = 'new_contact'
       AND bi.status = 'pending'
       AND bi.reason_codes @> ARRAY['object_kind:person_contact']
     ORDER BY bi.id
  LOOP
    IF coalesce(btrim(v_item.full_name), '') = '' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_connected := CASE
      WHEN btrim(coalesce(v_item.connected_on, '')) ~ '^\d{4}-\d{2}-\d{2}$'
        THEN btrim(v_item.connected_on)::date
      ELSE NULL
    END;

    INSERT INTO public.network_contacts
      (user_id, display_name, headline, company, connected_on, source_system, source_ref, is_active, last_observed_at)
    VALUES
      (p_user_id, btrim(v_item.full_name), nullif(btrim(coalesce(v_item.position, '')), ''),
       nullif(btrim(coalesce(v_item.company, '')), ''), v_connected,
       'linkedin_import', v_item.staging_record_id::text, true, now())
    RETURNING id INTO v_contact_id;

    IF coalesce(btrim(coalesce(v_item.profile_url, '')), '') <> '' THEN
      INSERT INTO public.network_contact_identities
        (user_id, network_contact_id, identity_kind, identity_key,
         identity_value_preview, source_system, first_observed_at, last_observed_at)
      VALUES
        (p_user_id, v_contact_id, 'linkedin_profile_url', lower(btrim(v_item.profile_url)),
         lower(btrim(v_item.profile_url)), 'linkedin_import', now(), now())
      ON CONFLICT DO NOTHING;
    END IF;

    IF coalesce(btrim(coalesce(v_item.company, '')), '') <> '' THEN
      INSERT INTO public.network_contact_company_relations
        (user_id, network_contact_id, company_name_observed, relation_kind, source_system, observed_at)
      VALUES
        (p_user_id, v_contact_id, btrim(v_item.company), 'unknown', 'linkedin_import', now())
      ON CONFLICT DO NOTHING;
    END IF;

    UPDATE public.linkedin_network_reconciliation_batch_items
       SET status = 'approved',
           target_contact_id = v_contact_id,
           updated_at = now()
     WHERE id = v_item.id
       AND user_id = p_user_id;

    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'batch_id', p_batch_id,
    'created_count', v_created,
    'skipped_count', v_skipped,
    'requested_count', array_length(p_item_ids, 1)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.network_promote_batch_person_contacts(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.network_promote_batch_person_contacts(uuid, uuid, uuid[]) TO service_role;