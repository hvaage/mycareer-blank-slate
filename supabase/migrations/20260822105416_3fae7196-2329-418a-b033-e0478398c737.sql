ALTER TABLE public.network_contacts
  ADD COLUMN IF NOT EXISTS manual_display_name text,
  ADD COLUMN IF NOT EXISTS manual_headline text,
  ADD COLUMN IF NOT EXISTS manual_updated_at timestamptz;

ALTER TABLE public.network_contact_company_relations
  ADD COLUMN IF NOT EXISTS source_class text NOT NULL DEFAULT 'linkedin_observed',
  ADD COLUMN IF NOT EXISTS valid_from date,
  ADD COLUMN IF NOT EXISTS valid_to date,
  ADD COLUMN IF NOT EXISTS relation_status text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'network_contact_company_relations_source_class_check'
  ) THEN
    ALTER TABLE public.network_contact_company_relations
      ADD CONSTRAINT network_contact_company_relations_source_class_check
      CHECK (source_class IN ('linkedin_observed', 'user_input'));
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS network_contact_company_relations_one_active_idx
  ON public.network_contact_company_relations (user_id, network_contact_id)
  WHERE is_active;

REVOKE UPDATE ON public.network_contacts FROM authenticated;

CREATE OR REPLACE FUNCTION public.network_update_contact_manual_fields(
  p_user_id uuid,
  p_contact_id uuid,
  p_display_name text,
  p_headline text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_display text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_headline text := nullif(btrim(coalesce(p_headline, '')), '');
  v_rows integer := 0;
BEGIN
  IF p_user_id IS NULL OR p_contact_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'missing_arguments');
  END IF;

  IF length(coalesce(v_display, '')) > 300 OR length(coalesce(v_headline, '')) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'value_too_long');
  END IF;

  UPDATE public.network_contacts
     SET manual_display_name = v_display,
         manual_headline = v_headline,
         manual_updated_at = CASE
           WHEN v_display IS NULL AND v_headline IS NULL THEN NULL
           ELSE now()
         END,
         updated_at = now()
   WHERE id = p_contact_id
     AND user_id = p_user_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'contact_not_found');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'source_class', CASE WHEN v_display IS NULL AND v_headline IS NULL
                         THEN 'linkedin_observed' ELSE 'user_input' END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.network_set_contact_company_relation(
  p_user_id uuid,
  p_contact_id uuid,
  p_company_name text,
  p_relation_kind text DEFAULT 'unknown',
  p_relation_status text DEFAULT NULL,
  p_valid_from date DEFAULT NULL,
  p_valid_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_name text := nullif(btrim(coalesce(p_company_name, '')), '');
  v_kind text := coalesce(nullif(btrim(coalesce(p_relation_kind, '')), ''), 'unknown');
  v_relation_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_contact_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'missing_arguments');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.network_contacts
     WHERE id = p_contact_id AND user_id = p_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'contact_not_found');
  END IF;

  IF v_kind NOT IN ('current_employer', 'past_employer', 'affiliation', 'unknown') THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_relation_kind');
  END IF;

  UPDATE public.network_contact_company_relations
     SET is_active = false,
         updated_at = now()
   WHERE user_id = p_user_id
     AND network_contact_id = p_contact_id
     AND is_active;

  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'cleared', true);
  END IF;

  SELECT id INTO v_relation_id
    FROM public.network_contact_company_relations
   WHERE user_id = p_user_id
     AND network_contact_id = p_contact_id
     AND source_class = 'user_input'
     AND lower(btrim(coalesce(company_name_observed, ''))) = lower(v_name)
   LIMIT 1;

  IF v_relation_id IS NULL THEN
    INSERT INTO public.network_contact_company_relations
      (user_id, network_contact_id, company_name_observed, relation_kind,
       source_system, observed_at, source_class, relation_status,
       valid_from, valid_to, is_active)
    VALUES
      (p_user_id, p_contact_id, v_name, v_kind, 'user_input', now(), 'user_input',
       nullif(btrim(coalesce(p_relation_status, '')), ''), p_valid_from, p_valid_to, true)
    RETURNING id INTO v_relation_id;
  ELSE
    UPDATE public.network_contact_company_relations
       SET relation_kind = v_kind,
           relation_status = nullif(btrim(coalesce(p_relation_status, '')), ''),
           valid_from = p_valid_from,
           valid_to = p_valid_to,
           is_active = true,
           updated_at = now()
     WHERE id = v_relation_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'relation_id', v_relation_id, 'source_class', 'user_input');
END;
$function$;

REVOKE ALL ON FUNCTION public.network_update_contact_manual_fields(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.network_update_contact_manual_fields(uuid, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.network_update_contact_manual_fields(uuid, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.network_update_contact_manual_fields(uuid, uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.network_set_contact_company_relation(uuid, uuid, text, text, text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.network_set_contact_company_relation(uuid, uuid, text, text, text, date, date) FROM anon;
REVOKE ALL ON FUNCTION public.network_set_contact_company_relation(uuid, uuid, text, text, text, date, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.network_set_contact_company_relation(uuid, uuid, text, text, text, date, date) TO service_role;