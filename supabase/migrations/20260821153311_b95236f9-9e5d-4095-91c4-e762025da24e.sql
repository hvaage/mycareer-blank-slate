ALTER TABLE public.user_company_relationships
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS priority text;

ALTER TABLE public.user_company_relationships
  DROP CONSTRAINT IF EXISTS user_company_relationships_status_check;
ALTER TABLE public.user_company_relationships
  ADD CONSTRAINT user_company_relationships_status_check
  CHECK (status IS NULL OR status IN ('following','target','active_dialogue','applied','former_employer','paused'));

ALTER TABLE public.user_company_relationships
  DROP CONSTRAINT IF EXISTS user_company_relationships_priority_check;
ALTER TABLE public.user_company_relationships
  ADD CONSTRAINT user_company_relationships_priority_check
  CHECK (priority IS NULL OR priority IN ('low','normal','high'));

REVOKE ALL ON TABLE public.network_contacts FROM anon;

CREATE OR REPLACE FUNCTION public.network_set_company_relationship(
  p_user_id uuid,
  p_company_id uuid,
  p_status text DEFAULT NULL,
  p_priority text DEFAULT NULL,
  p_company_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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
      (p_user_id, p_company_id, p_company_name, 'user_declared', p_status, p_priority, 'user_input')
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
$$;

REVOKE ALL ON FUNCTION public.network_set_company_relationship(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.network_set_company_relationship(uuid, uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.network_set_company_relationship(uuid, uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.network_set_company_relationship(uuid, uuid, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.network_promote_batch_person_contacts(
  p_user_id uuid,
  p_batch_id uuid,
  p_item_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_batch public.linkedin_network_reconciliation_batches%ROWTYPE;
  v_item RECORD;
  v_contact_id uuid;
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

    INSERT INTO public.network_contacts
      (user_id, display_name, headline, company, connected_on, source_system, source_ref, is_active, last_observed_at)
    VALUES
      (p_user_id, btrim(v_item.full_name), nullif(btrim(coalesce(v_item.position, '')), ''),
       nullif(btrim(coalesce(v_item.company, '')), ''), v_item.connected_on,
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
        (p_user_id, v_contact_id, btrim(v_item.company), 'observed_employment', 'linkedin_import', now())
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
$$;

REVOKE ALL ON FUNCTION public.network_promote_batch_person_contacts(uuid, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.network_promote_batch_person_contacts(uuid, uuid, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.network_promote_batch_person_contacts(uuid, uuid, uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.network_promote_batch_person_contacts(uuid, uuid, uuid[]) TO service_role;