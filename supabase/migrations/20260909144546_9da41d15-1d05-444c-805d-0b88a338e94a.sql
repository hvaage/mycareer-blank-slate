-- ============================================================
-- OAuth-korreksjon: obligatorisk ressursbinding, minste rettigheter
-- på auditlogg, sannferdig tabellkommentar og provenance i CIMD-oppslag.
-- Additiv og reverserbar.
-- ============================================================

-- ---------- 1. Ressursbinding er obligatorisk ----------
-- Koder har 60 sekunders levetid. Utløpte/forbrukte NULL-koder slettes.
DELETE FROM public.oauth_authorization_codes
 WHERE resource IS NULL
   AND (consumed_at IS NOT NULL OR expires_at <= now());

-- Eventuelle gjenværende NULL-koder er høyst sekunder gamle og kan ikke
-- bindes til en oppdiktet ressurs. De fjernes; klienten kan be om ny kode.
DELETE FROM public.oauth_authorization_codes WHERE resource IS NULL;

ALTER TABLE public.oauth_authorization_codes
  ALTER COLUMN resource SET NOT NULL;

COMMENT ON COLUMN public.oauth_authorization_codes.resource IS
  'Obligatorisk ressursbinding fra authorize. Sammenlignes eksakt ved innløsing.';

-- ---------- 2. Innløsing: eksakt, ikke-null ressurs ----------
CREATE OR REPLACE FUNCTION public.oauth_redeem_authorization_code_v2(
  p_code_hash text,
  p_client_row_id uuid,
  p_redirect_uri text,
  p_code_challenge text,
  p_resource text,
  p_refresh_token_hash text,
  p_refresh_expires_at timestamptz
)
RETURNS TABLE (
  ok boolean,
  reason text,
  grant_id uuid,
  user_id uuid,
  ai_integration_id uuid,
  provider text,
  scopes text[],
  family_id uuid
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code public.oauth_authorization_codes%ROWTYPE;
  v_client public.oauth_clients%ROWTYPE;
  v_status text;
  v_provider text;
  v_grant_id uuid;
  v_family uuid := gen_random_uuid();
BEGIN
  -- Ressurs må være oppgitt. NULL og tom streng avvises før alt annet.
  IF p_resource IS NULL OR btrim(p_resource) = '' THEN
    RETURN QUERY SELECT false, 'resource_mismatch', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_code_hash, 42));

  SELECT * INTO v_client FROM public.oauth_clients WHERE id = p_client_row_id FOR UPDATE;
  IF NOT FOUND OR v_client.is_active = false
     OR (v_client.expires_at IS NOT NULL AND v_client.expires_at <= now())
     OR (v_client.registration_method = 'cimd'
         AND v_client.metadata_expires_at IS NOT NULL
         AND v_client.metadata_expires_at <= now()) THEN
    RETURN QUERY SELECT false, 'client_unusable', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_code FROM public.oauth_authorization_codes
   WHERE code_hash = p_code_hash FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.oauth_security_events (event_type, client_row_id, detail)
    VALUES ('authorization_code_unknown', p_client_row_id, '{}'::jsonb);
    RETURN QUERY SELECT false, 'unknown_code', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  IF v_code.consumed_at IS NOT NULL THEN
    INSERT INTO public.oauth_security_events (event_type, client_row_id, user_id, detail)
    VALUES ('authorization_code_reuse', v_code.client_id, v_code.user_id, '{}'::jsonb);
    RETURN QUERY SELECT false, 'code_reused', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  IF v_code.expires_at <= now() THEN
    RETURN QUERY SELECT false, 'expired', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text[], NULL::uuid;
    RETURN;
  END IF;
  IF v_code.client_id <> p_client_row_id THEN
    RETURN QUERY SELECT false, 'client_mismatch', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text[], NULL::uuid;
    RETURN;
  END IF;
  IF v_code.redirect_uri <> p_redirect_uri THEN
    RETURN QUERY SELECT false, 'redirect_mismatch', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text[], NULL::uuid;
    RETURN;
  END IF;
  -- IS DISTINCT FROM: NULL i raden slipper ikke gjennom.
  IF v_code.resource IS DISTINCT FROM p_resource THEN
    RETURN QUERY SELECT false, 'resource_mismatch', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text[], NULL::uuid;
    RETURN;
  END IF;
  IF p_code_challenge IS NULL OR v_code.code_challenge <> p_code_challenge THEN
    INSERT INTO public.oauth_security_events (event_type, client_row_id, user_id, detail)
    VALUES ('pkce_mismatch', v_code.client_id, v_code.user_id, '{}'::jsonb);
    RETURN QUERY SELECT false, 'pkce_mismatch', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text[], NULL::uuid;
    RETURN;
  END IF;
  IF v_code.ai_integration_id IS NULL THEN
    RETURN QUERY SELECT false, 'no_integration', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  SELECT i.status, i.provider INTO v_status, v_provider
  FROM public.ai_integrations i
  WHERE i.id = v_code.ai_integration_id AND i.user_id = v_code.user_id
  FOR UPDATE;

  IF v_status IS NULL OR v_status NOT IN ('connecting', 'active') THEN
    RETURN QUERY SELECT false, 'integration_unusable', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  UPDATE public.oauth_authorization_codes SET consumed_at = now() WHERE id = v_code.id;

  IF v_status = 'connecting' THEN
    UPDATE public.ai_integrations
       SET status = 'active', last_verified_at = now(), updated_at = now()
     WHERE id = v_code.ai_integration_id;
  ELSE
    UPDATE public.ai_integrations
       SET last_verified_at = now(), updated_at = now()
     WHERE id = v_code.ai_integration_id;
  END IF;

  SELECT g.id INTO v_grant_id
  FROM public.oauth_grants g
  WHERE g.user_id = v_code.user_id
    AND g.ai_integration_id = v_code.ai_integration_id
    AND g.client_id = v_code.client_id
    AND g.status = 'active'
  FOR UPDATE;

  IF v_grant_id IS NULL THEN
    INSERT INTO public.oauth_grants (user_id, ai_integration_id, client_id, scopes)
    VALUES (v_code.user_id, v_code.ai_integration_id, v_code.client_id, v_code.scopes)
    RETURNING id INTO v_grant_id;
  ELSE
    UPDATE public.oauth_grants SET scopes = v_code.scopes, updated_at = now() WHERE id = v_grant_id;
  END IF;

  INSERT INTO public.oauth_refresh_tokens (token_hash, grant_id, family_id, expires_at)
  VALUES (p_refresh_token_hash, v_grant_id, v_family, p_refresh_expires_at);

  UPDATE public.oauth_clients SET last_used_at = now(), updated_at = now() WHERE id = p_client_row_id;

  RETURN QUERY SELECT true, 'ok', v_grant_id, v_code.user_id, v_code.ai_integration_id,
                      v_provider, v_code.scopes, v_family;
END;
$$;

REVOKE ALL ON FUNCTION public.oauth_redeem_authorization_code_v2(text, uuid, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oauth_redeem_authorization_code_v2(text, uuid, text, text, text, text, timestamptz) TO service_role;

-- ---------- 3. CIMD-oppslag returnerer provenance ----------
DROP FUNCTION IF EXISTS public.oauth_upsert_cimd_client(text, text, text, text[], text[], timestamptz);

CREATE FUNCTION public.oauth_upsert_cimd_client(
  p_client_id text,
  p_client_name text,
  p_metadata_url text,
  p_redirect_uris text[],
  p_allowed_scopes text[],
  p_metadata_expires_at timestamptz
)
RETURNS TABLE (id uuid, client_id text, client_name text, client_type text,
               is_active boolean, redirect_uris text[], allowed_scopes text[],
               registration_method text, metadata_url text)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.oauth_clients%ROWTYPE;
BEGIN
  IF p_metadata_url IS NULL OR p_metadata_url NOT LIKE 'https://%' THEN
    RAISE EXCEPTION 'invalid_metadata_url';
  END IF;
  IF NOT public.oauth_is_valid_scope_set(p_allowed_scopes)
     OR NOT public.oauth_is_valid_uri_set(p_redirect_uris) THEN
    RAISE EXCEPTION 'invalid_client_metadata';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id, 45));

  INSERT INTO public.oauth_clients AS c
    (client_id, client_name, client_type, redirect_uris, allowed_scopes,
     registration_method, metadata_url, metadata_validated_at, metadata_expires_at, is_active)
  VALUES
    (p_client_id, p_client_name, 'public', p_redirect_uris, p_allowed_scopes,
     'cimd', p_metadata_url, now(), p_metadata_expires_at, true)
  ON CONFLICT (client_id) DO UPDATE
    SET client_name = EXCLUDED.client_name,
        redirect_uris = EXCLUDED.redirect_uris,
        allowed_scopes = EXCLUDED.allowed_scopes,
        registration_method = 'cimd',
        metadata_url = EXCLUDED.metadata_url,
        metadata_validated_at = now(),
        metadata_expires_at = EXCLUDED.metadata_expires_at,
        is_active = true,
        updated_at = now()
    WHERE c.registration_method <> 'manual'
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'client_id_reserved';
  END IF;

  INSERT INTO public.oauth_security_events (event_type, client_row_id, detail)
  VALUES ('cimd_client_validated', v_row.id, jsonb_build_object('metadata_url', p_metadata_url));

  RETURN QUERY SELECT v_row.id, v_row.client_id, v_row.client_name, v_row.client_type,
                      v_row.is_active, v_row.redirect_uris, v_row.allowed_scopes,
                      v_row.registration_method, v_row.metadata_url;
END;
$$;

REVOKE ALL ON FUNCTION public.oauth_upsert_cimd_client(text, text, text, text[], text[], timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oauth_upsert_cimd_client(text, text, text, text[], text[], timestamptz) TO service_role;

-- ---------- 4. Minste rettigheter og sannferdig beskrivelse ----------
REVOKE ALL ON public.oauth_security_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON public.oauth_security_events TO service_role;

COMMENT ON TABLE public.oauth_security_events IS
  'Sikkerhetshendelser for OAuth. Inneholder aldri tokener, autorisasjonskoder eller hemmeligheter. user_id er en pseudonym identifikator som følger brukerens konto og slettes ved kontosletting; rader ryddes etter behov av drift.';
