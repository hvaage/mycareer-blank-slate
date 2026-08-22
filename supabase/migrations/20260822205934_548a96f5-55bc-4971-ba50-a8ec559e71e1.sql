
ALTER TABLE public.network_contacts
  ADD COLUMN IF NOT EXISTS manual_email text,
  ADD COLUMN IF NOT EXISTS manual_phone text,
  ADD COLUMN IF NOT EXISTS manual_notes text,
  ADD COLUMN IF NOT EXISTS manual_relation_status text;

ALTER TABLE public.network_contacts
  DROP CONSTRAINT IF EXISTS network_contacts_manual_relation_status_check;
ALTER TABLE public.network_contacts
  ADD CONSTRAINT network_contacts_manual_relation_status_check
  CHECK (manual_relation_status IS NULL OR manual_relation_status IN ('ukjent','varm','aktiv','referanse','ikke_aktuell'));

-- Bruker-scopede nøkler slik at anbefalingskoblingen kan håndheves av databasen.
ALTER TABLE public.network_contacts
  DROP CONSTRAINT IF EXISTS network_contacts_id_user_id_key;
ALTER TABLE public.network_contacts
  ADD CONSTRAINT network_contacts_id_user_id_key UNIQUE (id, user_id);

ALTER TABLE public.career_recommendations
  ADD COLUMN IF NOT EXISTS network_contact_id uuid;

ALTER TABLE public.career_recommendations
  DROP CONSTRAINT IF EXISTS career_recommendations_network_contact_fk;
ALTER TABLE public.career_recommendations
  ADD CONSTRAINT career_recommendations_network_contact_fk
  FOREIGN KEY (network_contact_id, user_id)
  REFERENCES public.network_contacts (id, user_id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS career_recommendations_network_contact_idx
  ON public.career_recommendations (user_id, network_contact_id)
  WHERE network_contact_id IS NOT NULL;

-- ---------------------------------------------------------------
-- Kontaktpunkter: kun brukerens eksplisitte verdier.
-- auth.uid() er eneste autoritative brukeridentitet.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.network_update_contact_contact_points(
  p_contact_id uuid,
  p_email text,
  p_phone text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_row public.network_contacts%ROWTYPE;
  v_changed boolean;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'no_session');
  END IF;
  IF p_contact_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'missing_arguments');
  END IF;

  IF v_email IS NOT NULL AND v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_email');
  END IF;
  IF length(coalesce(v_email, '')) > 320 OR length(coalesce(v_phone, '')) > 60 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'value_too_long');
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^[+0-9][0-9 ()./-]{2,}$' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_phone');
  END IF;

  -- Forsiktig normalisering for visning: kollaps mellomrom.
  IF v_phone IS NOT NULL THEN
    v_phone := btrim(regexp_replace(v_phone, '\s+', ' ', 'g'));
  END IF;

  SELECT * INTO v_row FROM public.network_contacts
   WHERE id = p_contact_id AND user_id = v_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'contact_not_found');
  END IF;

  v_changed := (v_row.manual_email IS DISTINCT FROM v_email)
            OR (v_row.manual_phone IS DISTINCT FROM v_phone);

  IF v_changed THEN
    UPDATE public.network_contacts
       SET manual_email = v_email,
           manual_phone = v_phone,
           manual_updated_at = now(),
           updated_at = now()
     WHERE id = p_contact_id AND user_id = v_user;
  END IF;

  RETURN jsonb_build_object('ok', true, 'changed', v_changed,
                            'email', v_email, 'phone', v_phone);
END;
$function$;

-- ---------------------------------------------------------------
-- Manuelle profilfelt + notater + brukerens relasjon til personen.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.network_update_contact_manual_profile(
  p_contact_id uuid,
  p_display_name text,
  p_headline text,
  p_notes text,
  p_relation_status text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_display text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_headline text := nullif(btrim(coalesce(p_headline, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_status text := nullif(btrim(coalesce(p_relation_status, '')), '');
  v_row public.network_contacts%ROWTYPE;
  v_changed boolean;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'no_session');
  END IF;
  IF p_contact_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'missing_arguments');
  END IF;
  IF length(coalesce(v_display,'')) > 300 OR length(coalesce(v_headline,'')) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'value_too_long');
  END IF;
  IF length(coalesce(v_notes,'')) > 4000 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'notes_too_long');
  END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('ukjent','varm','aktiv','referanse','ikke_aktuell') THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_relation_status');
  END IF;

  SELECT * INTO v_row FROM public.network_contacts
   WHERE id = p_contact_id AND user_id = v_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'contact_not_found');
  END IF;

  v_changed := (v_row.manual_display_name IS DISTINCT FROM v_display)
            OR (v_row.manual_headline IS DISTINCT FROM v_headline)
            OR (v_row.manual_notes IS DISTINCT FROM v_notes)
            OR (v_row.manual_relation_status IS DISTINCT FROM v_status);

  IF v_changed THEN
    UPDATE public.network_contacts
       SET manual_display_name = v_display,
           manual_headline = v_headline,
           manual_notes = v_notes,
           manual_relation_status = v_status,
           manual_updated_at = now(),
           updated_at = now()
     WHERE id = p_contact_id AND user_id = v_user;
  END IF;

  RETURN jsonb_build_object('ok', true, 'changed', v_changed);
END;
$function$;

-- ---------------------------------------------------------------
-- Anbefalingskobling: kun mottatte anbefalinger, kun eksplisitt handling.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.network_link_recommendation_contact(
  p_recommendation_id uuid,
  p_contact_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_direction public.career_recommendation_direction;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'no_session');
  END IF;
  IF p_recommendation_id IS NULL OR p_contact_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'missing_arguments');
  END IF;

  SELECT direction INTO v_direction
    FROM public.career_recommendations
   WHERE id = p_recommendation_id AND user_id = v_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'recommendation_not_found');
  END IF;
  IF v_direction IS DISTINCT FROM 'received'::public.career_recommendation_direction THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'direction_not_received');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.network_contacts
     WHERE id = p_contact_id AND user_id = v_user
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'contact_not_found');
  END IF;

  UPDATE public.career_recommendations
     SET network_contact_id = p_contact_id,
         updated_at = now()
   WHERE id = p_recommendation_id AND user_id = v_user;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.network_unlink_recommendation_contact(
  p_recommendation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_rows integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'no_session');
  END IF;

  UPDATE public.career_recommendations
     SET network_contact_id = NULL,
         updated_at = now()
   WHERE id = p_recommendation_id AND user_id = v_user;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'recommendation_not_found');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.network_update_contact_contact_points(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.network_update_contact_manual_profile(uuid, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.network_link_recommendation_contact(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.network_unlink_recommendation_contact(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.network_update_contact_contact_points(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.network_update_contact_manual_profile(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.network_link_recommendation_contact(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.network_unlink_recommendation_contact(uuid) TO authenticated;
