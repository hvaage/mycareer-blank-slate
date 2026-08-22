-- 1) Kvalitetsregel for selskapsnavn (speiler klientlogikken i src/lib/network/company-name.ts)
CREATE OR REPLACE FUNCTION public.network_company_name_quality(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT CASE
    WHEN coalesce(btrim(p_name), '') = '' THEN 'symbol_only'
    WHEN btrim(p_name) !~ '[[:alnum:]]' THEN 'symbol_only'
    WHEN btrim(p_name) !~ '[[:alpha:]]' THEN 'symbol_only'
    WHEN btrim(p_name) ~ '^[#＃]' OR btrim(p_name) ~ '(^|[[:space:]])#[[:alpha:]]' THEN 'hashtag_promo'
    WHEN btrim(p_name) ~* '(https?://|www\.)' THEN 'url'
    WHEN btrim(p_name) ~* '(podkast|podcast|følg (meg|oss)|vi hjelper|open to work|søker (ny )?jobb|ledig for oppdrag|kontakt meg)' THEN 'promotional'
    WHEN length(btrim(p_name)) > 70 THEN 'too_long'
    ELSE 'ok'
  END;
$$;

CREATE OR REPLACE FUNCTION public.network_company_name_is_junk(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT public.network_company_name_quality(p_name) <> 'ok';
$$;

GRANT EXECUTE ON FUNCTION public.network_company_name_quality(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.network_company_name_is_junk(text) TO authenticated, service_role;

-- 2) Brukerstyrt skjuling/sletting av selskaper i nettverksregisteret
CREATE TABLE IF NOT EXISTS public.network_hidden_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_key text NOT NULL,
  company_id uuid NULL,
  company_name text NULL,
  reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.network_hidden_companies TO authenticated;
GRANT ALL ON public.network_hidden_companies TO service_role;

ALTER TABLE public.network_hidden_companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own hidden companies" ON public.network_hidden_companies;
CREATE POLICY "own hidden companies"
  ON public.network_hidden_companies
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.network_hide_company(
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
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'not_authenticated');
  END IF;
  IF coalesce(btrim(p_company_key), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'missing_company_key');
  END IF;

  INSERT INTO public.network_hidden_companies (user_id, company_key, company_id, company_name, reason)
  VALUES (v_user, btrim(p_company_key), p_company_id, nullif(btrim(coalesce(p_company_name, '')), ''), nullif(btrim(coalesce(p_reason, '')), ''))
  ON CONFLICT (user_id, company_key)
  DO UPDATE SET company_id = COALESCE(EXCLUDED.company_id, public.network_hidden_companies.company_id),
                company_name = COALESCE(EXCLUDED.company_name, public.network_hidden_companies.company_name),
                reason = COALESCE(EXCLUDED.reason, public.network_hidden_companies.reason);

  RETURN jsonb_build_object('ok', true, 'company_key', btrim(p_company_key));
END;
$$;

CREATE OR REPLACE FUNCTION public.network_unhide_company(p_company_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_deleted integer;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'not_authenticated');
  END IF;

  DELETE FROM public.network_hidden_companies
   WHERE user_id = v_user
     AND company_key = btrim(p_company_key);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'restored_count', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.network_hide_company(text, uuid, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.network_unhide_company(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.network_hide_company(text, uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.network_unhide_company(text) TO authenticated, service_role;

-- 3) Promotering skal ikke lage selskapsdata av ugyldige navn
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
  v_company text;
  v_created integer := 0;
  v_skipped integer := 0;
  v_rejected_company integer := 0;
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

    v_company := nullif(btrim(coalesce(v_item.company, '')), '');
    IF v_company IS NOT NULL AND public.network_company_name_is_junk(v_company) THEN
      v_company := NULL;
      v_rejected_company := v_rejected_company + 1;
    END IF;

    INSERT INTO public.network_contacts
      (user_id, display_name, headline, company, connected_on, source_system, source_ref, is_active, last_observed_at)
    VALUES
      (p_user_id, btrim(v_item.full_name), nullif(btrim(coalesce(v_item.position, '')), ''),
       v_company, v_connected,
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

    IF v_company IS NOT NULL THEN
      INSERT INTO public.network_contact_company_relations
        (user_id, network_contact_id, company_name_observed, relation_kind, source_system, observed_at)
      VALUES
        (p_user_id, v_contact_id, v_company, 'unknown', 'linkedin_import', now())
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
    'rejected_company_name_count', v_rejected_company,
    'requested_count', array_length(p_item_ids, 1)
  );
END;
$function$;