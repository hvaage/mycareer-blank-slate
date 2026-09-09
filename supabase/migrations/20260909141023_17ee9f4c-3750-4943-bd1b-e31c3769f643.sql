-- ============================================================
-- OAuth-herding: CIMD, herdet DCR, atomisk statusaktivering og audit.
-- Alt er additivt. Eksisterende funksjoner beholdes urørt; nye v2-
-- funksjoner erstatter dem i applikasjonslaget.
-- ============================================================

-- ---------- 1. oauth_clients: registreringsmetode og livssyklus ----------
ALTER TABLE public.oauth_clients
  ADD COLUMN IF NOT EXISTS registration_method text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS metadata_url text,
  ADD COLUMN IF NOT EXISTS metadata_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

ALTER TABLE public.oauth_clients
  DROP CONSTRAINT IF EXISTS oauth_clients_registration_method_check,
  ADD CONSTRAINT oauth_clients_registration_method_check
    CHECK (registration_method IN ('manual', 'cimd', 'dcr'));

-- CIMD-klienter MÅ ha en https metadata-URL og et valideringstidspunkt.
ALTER TABLE public.oauth_clients
  DROP CONSTRAINT IF EXISTS oauth_clients_cimd_metadata_required,
  ADD CONSTRAINT oauth_clients_cimd_metadata_required CHECK (
    registration_method <> 'cimd'
    OR (metadata_url IS NOT NULL AND metadata_url LIKE 'https://%' AND metadata_validated_at IS NOT NULL)
  );

-- DCR-klienter MÅ ha utløp. Ingen ubegrenset opphopning.
ALTER TABLE public.oauth_clients
  DROP CONSTRAINT IF EXISTS oauth_clients_dcr_expiry_required,
  ADD CONSTRAINT oauth_clients_dcr_expiry_required CHECK (
    registration_method <> 'dcr' OR expires_at IS NOT NULL
  );

-- Ingen klient utenfor 'manual' får være konfidensiell.
ALTER TABLE public.oauth_clients
  DROP CONSTRAINT IF EXISTS oauth_clients_registered_are_public,
  ADD CONSTRAINT oauth_clients_registered_are_public CHECK (
    registration_method = 'manual' OR client_type = 'public'
  );

CREATE UNIQUE INDEX IF NOT EXISTS oauth_clients_metadata_url_key
  ON public.oauth_clients (metadata_url) WHERE metadata_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS oauth_clients_expires_at_idx
  ON public.oauth_clients (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS oauth_clients_registration_method_idx
  ON public.oauth_clients (registration_method);

COMMENT ON COLUMN public.oauth_clients.registration_method IS
  'manual = forhåndsregistrert, cimd = Client ID Metadata Document, dcr = dynamisk registrering (fallback).';

-- ---------- 2. Ressursbinding på autorisasjonskoden ----------
ALTER TABLE public.oauth_authorization_codes
  ADD COLUMN IF NOT EXISTS resource text;

-- ---------- 3. Copilot som femte likestilte leverandør ----------
ALTER TABLE public.ai_integrations
  DROP CONSTRAINT IF EXISTS ai_integrations_provider_check,
  ADD CONSTRAINT ai_integrations_provider_check
    CHECK (provider IN ('grok', 'claude', 'openai', 'gemini', 'copilot'));

ALTER TABLE public.ai_integration_setup_sessions
  DROP CONSTRAINT IF EXISTS ai_setup_sessions_provider_check,
  ADD CONSTRAINT ai_setup_sessions_provider_check
    CHECK (provider IN ('grok', 'claude', 'openai', 'gemini', 'copilot'));

ALTER TABLE public.career_log_suggestions
  DROP CONSTRAINT IF EXISTS career_log_suggestions_provider_check,
  ADD CONSTRAINT career_log_suggestions_provider_check
    CHECK (provider IN ('grok', 'claude', 'openai', 'gemini', 'copilot'));

-- ---------- 4. Sikkerhetshendelser (audit) ----------
CREATE TABLE IF NOT EXISTS public.oauth_security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  client_row_id uuid REFERENCES public.oauth_clients(id) ON DELETE SET NULL,
  grant_id uuid REFERENCES public.oauth_grants(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.oauth_security_events TO service_role;
REVOKE ALL ON public.oauth_security_events FROM anon, authenticated;
ALTER TABLE public.oauth_security_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "oauth_security_events_no_client_access" ON public.oauth_security_events;
CREATE POLICY "oauth_security_events_no_client_access"
  ON public.oauth_security_events FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS oauth_security_events_occurred_idx
  ON public.oauth_security_events (occurred_at DESC);

COMMENT ON TABLE public.oauth_security_events IS
  'Sikkerhetshendelser for OAuth. Inneholder aldri tokener, koder, hemmeligheter eller persondata.';

-- ---------- 5. Innløsing av authorization code, v2 ----------
-- Endringer mot v1:
--   * ressurs sammenlignes eksakt
--   * klientens aktive/utløpte status kontrolleres
--   * integrasjonens status må være connecting eller active
--   * connecting -> active skjer i SAMME transaksjon
--   * capabilities røres aldri
--   * gjenbruk av kode gir invalid_grant + audit, men ingen bred revokering
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
    -- Gjenbruk: logg hendelsen, men trekk IKKE andre aktive grants.
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
  IF v_code.resource IS NOT NULL AND v_code.resource <> p_resource THEN
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

  -- Statusaktivering i samme transaksjon. capabilities og effective_mode
  -- røres bevisst ikke: OAuth bekrefter forbindelse, ikke egenskaper.
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

-- ---------- 6. Rotasjon av refresh token, v2 ----------
-- Replay trekker KUN tokenfamilien, aldri grantet eller andre grants.
CREATE OR REPLACE FUNCTION public.oauth_rotate_refresh_token_v2(
  p_token_hash text,
  p_client_row_id uuid,
  p_new_token_hash text,
  p_new_expires_at timestamptz
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
  v_token public.oauth_refresh_tokens%ROWTYPE;
  v_grant public.oauth_grants%ROWTYPE;
  v_client public.oauth_clients%ROWTYPE;
  v_status text;
  v_provider text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_token_hash, 43));

  SELECT * INTO v_client FROM public.oauth_clients WHERE id = p_client_row_id;
  IF NOT FOUND OR v_client.is_active = false
     OR (v_client.expires_at IS NOT NULL AND v_client.expires_at <= now()) THEN
    RETURN QUERY SELECT false, 'client_unusable', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_token FROM public.oauth_refresh_tokens
   WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'unknown_token', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_grant FROM public.oauth_grants WHERE id = v_token.grant_id FOR UPDATE;

  IF v_token.status <> 'active' THEN
    UPDATE public.oauth_refresh_tokens
       SET status = 'revoked', revoked_at = now(),
           reuse_detected_at = COALESCE(reuse_detected_at, now())
     WHERE family_id = v_token.family_id AND status <> 'revoked';

    INSERT INTO public.oauth_security_events (event_type, client_row_id, grant_id, user_id, detail)
    VALUES ('refresh_token_reuse', p_client_row_id, v_token.grant_id, v_grant.user_id,
            jsonb_build_object('family_revoked', true, 'grant_revoked', false));

    RETURN QUERY SELECT false, 'reuse_detected', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  IF v_token.expires_at <= now() THEN
    UPDATE public.oauth_refresh_tokens SET status = 'revoked', revoked_at = now() WHERE id = v_token.id;
    RETURN QUERY SELECT false, 'expired', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text[], NULL::uuid;
    RETURN;
  END IF;
  IF v_grant.id IS NULL OR v_grant.status <> 'active' THEN
    RETURN QUERY SELECT false, 'grant_revoked', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text[], NULL::uuid;
    RETURN;
  END IF;
  IF v_grant.client_id <> p_client_row_id THEN
    RETURN QUERY SELECT false, 'client_mismatch', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  SELECT i.status, i.provider INTO v_status, v_provider
  FROM public.ai_integrations i WHERE i.id = v_grant.ai_integration_id;
  IF v_status IS NULL OR v_status NOT IN ('connecting', 'active') THEN
    RETURN QUERY SELECT false, 'integration_unusable', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  UPDATE public.oauth_refresh_tokens SET status = 'consumed', consumed_at = now() WHERE id = v_token.id;
  INSERT INTO public.oauth_refresh_tokens (token_hash, grant_id, family_id, parent_id, expires_at)
  VALUES (p_new_token_hash, v_token.grant_id, v_token.family_id, v_token.id, p_new_expires_at);

  UPDATE public.oauth_clients SET last_used_at = now(), updated_at = now() WHERE id = p_client_row_id;

  RETURN QUERY SELECT true, 'ok', v_grant.id, v_grant.user_id, v_grant.ai_integration_id,
                      v_provider, v_grant.scopes, v_token.family_id;
END;
$$;

-- ---------- 7. CIMD-klient: kontrollert opprettelse/oppdatering ----------
CREATE OR REPLACE FUNCTION public.oauth_upsert_cimd_client(
  p_client_id text,
  p_client_name text,
  p_metadata_url text,
  p_redirect_uris text[],
  p_allowed_scopes text[],
  p_metadata_expires_at timestamptz
)
RETURNS TABLE (id uuid, client_id text, client_name text, client_type text,
               is_active boolean, redirect_uris text[], allowed_scopes text[])
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
                      v_row.is_active, v_row.redirect_uris, v_row.allowed_scopes;
END;
$$;

-- ---------- 8. Opprydding av utløpte klienter ----------
CREATE OR REPLACE FUNCTION public.oauth_cleanup_expired_clients()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE v_count integer := 0;
BEGIN
  UPDATE public.oauth_clients
     SET is_active = false, updated_at = now()
   WHERE is_active = true
     AND registration_method = 'dcr'
     AND expires_at IS NOT NULL
     AND expires_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;

  DELETE FROM public.oauth_clients
   WHERE registration_method = 'dcr'
     AND is_active = false
     AND expires_at IS NOT NULL
     AND expires_at <= now() - interval '30 days'
     AND NOT EXISTS (SELECT 1 FROM public.oauth_grants g WHERE g.client_id = oauth_clients.id AND g.status = 'active');

  RETURN v_count;
END;
$$;

-- ---------- 9. Kjørerettigheter ----------
REVOKE ALL ON FUNCTION public.oauth_redeem_authorization_code_v2(text, uuid, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oauth_redeem_authorization_code_v2(text, uuid, text, text, text, text, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.oauth_rotate_refresh_token_v2(text, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oauth_rotate_refresh_token_v2(text, uuid, text, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.oauth_upsert_cimd_client(text, text, text, text[], text[], timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oauth_upsert_cimd_client(text, text, text, text[], text[], timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.oauth_cleanup_expired_clients() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oauth_cleanup_expired_clients() TO service_role;