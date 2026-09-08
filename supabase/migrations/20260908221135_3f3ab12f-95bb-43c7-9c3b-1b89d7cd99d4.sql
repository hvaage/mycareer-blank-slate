-- ============================================================
-- AI-integrasjon fase 3: atomiske OAuth-operasjoner.
--
-- Alle funksjonene er SECURITY INVOKER med fast search_path og kun
-- service_role execute. De finnes for å fjerne read-then-update-race:
-- lås, kontroll, skriving og retur skjer i samme transaksjon.
-- ============================================================

-- ---------- a) innløse authorization code ----------
CREATE OR REPLACE FUNCTION public.oauth_redeem_authorization_code(
  p_code_hash text,
  p_client_row_id uuid,
  p_redirect_uri text,
  p_code_challenge text,
  p_refresh_token_hash text,
  p_refresh_expires_at timestamptz
)
RETURNS TABLE (
  ok boolean,
  reason text,
  grant_id uuid,
  user_id uuid,
  ai_integration_id uuid,
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
  v_grant_id uuid;
  v_family uuid := gen_random_uuid();
BEGIN
  -- Serialiser alle forsøk på samme kode.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_code_hash, 42));

  SELECT * INTO v_code
  FROM public.oauth_authorization_codes
  WHERE code_hash = p_code_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'unknown_code', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  IF v_code.consumed_at IS NOT NULL THEN
    -- Gjenbruk: koden er allerede brukt. Trekk grantet som ble laget av den.
    UPDATE public.oauth_grants g
       SET status = 'revoked', revoked_at = now(), revoked_reason = 'authorization_code_reuse'
     WHERE g.user_id = v_code.user_id
       AND g.client_id = v_code.client_id
       AND g.status = 'active';
    RETURN QUERY SELECT false, 'code_reused', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  IF v_code.expires_at <= now() THEN
    RETURN QUERY SELECT false, 'expired', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  IF v_code.client_id <> p_client_row_id THEN
    RETURN QUERY SELECT false, 'client_mismatch', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  IF v_code.redirect_uri <> p_redirect_uri THEN
    RETURN QUERY SELECT false, 'redirect_mismatch', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  -- PKCE: kalleren sender BASE64URL(SHA256(verifier)). Sammenligningen
  -- skjer her, i samme transaksjon som konsumeringen.
  IF p_code_challenge IS NULL OR v_code.code_challenge <> p_code_challenge THEN
    RETURN QUERY SELECT false, 'pkce_mismatch', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  IF v_code.ai_integration_id IS NULL THEN
    RETURN QUERY SELECT false, 'no_integration', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  UPDATE public.oauth_authorization_codes
     SET consumed_at = now()
   WHERE id = v_code.id;

  -- Opprett eller gjenbruk aktivt grant for (bruker, integrasjon, klient).
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
    UPDATE public.oauth_grants
       SET scopes = v_code.scopes, updated_at = now()
     WHERE id = v_grant_id;
  END IF;

  INSERT INTO public.oauth_refresh_tokens (token_hash, grant_id, family_id, expires_at)
  VALUES (p_refresh_token_hash, v_grant_id, v_family, p_refresh_expires_at);

  RETURN QUERY SELECT true, 'ok', v_grant_id, v_code.user_id, v_code.ai_integration_id, v_code.scopes, v_family;
END;
$$;

-- ---------- b) rotere refresh token ----------
CREATE OR REPLACE FUNCTION public.oauth_rotate_refresh_token(
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
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_token_hash, 43));

  SELECT * INTO v_token
  FROM public.oauth_refresh_tokens
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'unknown_token', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_grant FROM public.oauth_grants WHERE id = v_token.grant_id FOR UPDATE;

  IF v_token.status <> 'active' THEN
    -- Gjenbruk av forbrukt/trukket token: trekk hele familien OG grantet.
    UPDATE public.oauth_refresh_tokens
       SET status = 'revoked',
           revoked_at = now(),
           reuse_detected_at = COALESCE(reuse_detected_at, now())
     WHERE family_id = v_token.family_id
       AND status <> 'revoked';

    UPDATE public.oauth_grants
       SET status = 'revoked', revoked_at = now(), revoked_reason = 'refresh_token_reuse'
     WHERE id = v_token.grant_id AND status = 'active';

    INSERT INTO public.oauth_access_token_revocations (grant_id, reason, expires_at)
    VALUES (v_token.grant_id, 'refresh_token_reuse', now() + interval '1 day');

    RETURN QUERY SELECT false, 'reuse_detected', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  IF v_token.expires_at <= now() THEN
    UPDATE public.oauth_refresh_tokens
       SET status = 'revoked', revoked_at = now()
     WHERE id = v_token.id;
    RETURN QUERY SELECT false, 'expired', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  IF v_grant.id IS NULL OR v_grant.status <> 'active' THEN
    RETURN QUERY SELECT false, 'grant_revoked', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  IF v_grant.client_id <> p_client_row_id THEN
    RETURN QUERY SELECT false, 'client_mismatch', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  UPDATE public.oauth_refresh_tokens
     SET status = 'consumed', consumed_at = now()
   WHERE id = v_token.id;

  INSERT INTO public.oauth_refresh_tokens (token_hash, grant_id, family_id, parent_id, expires_at)
  VALUES (p_new_token_hash, v_token.grant_id, v_token.family_id, v_token.id, p_new_expires_at);

  RETURN QUERY SELECT true, 'ok', v_grant.id, v_grant.user_id, v_grant.ai_integration_id, v_grant.scopes, v_token.family_id;
END;
$$;

-- ---------- c) trekke tilbake grant / hele integrasjonen ----------
CREATE OR REPLACE FUNCTION public.oauth_revoke_grants(
  p_grant_id uuid,
  p_ai_integration_id uuid,
  p_user_id uuid,
  p_reason text
)
RETURNS TABLE (revoked_grants integer, revoked_tokens integer)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids uuid[];
  v_grants integer := 0;
  v_tokens integer := 0;
BEGIN
  IF p_grant_id IS NULL AND p_ai_integration_id IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  SELECT array_agg(g.id) INTO v_ids
  FROM public.oauth_grants g
  WHERE g.status = 'active'
    AND (p_grant_id IS NULL OR g.id = p_grant_id)
    AND (p_ai_integration_id IS NULL OR g.ai_integration_id = p_ai_integration_id)
    AND (p_user_id IS NULL OR g.user_id = p_user_id);

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  UPDATE public.oauth_grants
     SET status = 'revoked', revoked_at = now(), revoked_reason = COALESCE(p_reason, 'revoked')
   WHERE id = ANY(v_ids);
  GET DIAGNOSTICS v_grants = ROW_COUNT;

  UPDATE public.oauth_refresh_tokens
     SET status = 'revoked', revoked_at = now()
   WHERE grant_id = ANY(v_ids) AND status <> 'revoked';
  GET DIAGNOSTICS v_tokens = ROW_COUNT;

  INSERT INTO public.oauth_access_token_revocations (grant_id, reason, expires_at)
  SELECT id, COALESCE(p_reason, 'revoked'), now() + interval '1 day'
  FROM unnest(v_ids) AS id;

  RETURN QUERY SELECT v_grants, v_tokens;
END;
$$;

-- ---------- d) RFC 7009: trekke ett refresh token ----------
CREATE OR REPLACE FUNCTION public.oauth_revoke_refresh_token(
  p_token_hash text,
  p_client_row_id uuid
)
RETURNS TABLE (revoked integer)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token public.oauth_refresh_tokens%ROWTYPE;
  v_count integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_token_hash, 44));

  SELECT t.* INTO v_token
  FROM public.oauth_refresh_tokens t
  JOIN public.oauth_grants g ON g.id = t.grant_id
  WHERE t.token_hash = p_token_hash
    AND g.client_id = p_client_row_id
  FOR UPDATE OF t;

  -- Idempotent: ukjent token er ikke en feil og røper ingenting.
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0;
    RETURN;
  END IF;

  UPDATE public.oauth_refresh_tokens
     SET status = 'revoked', revoked_at = now()
   WHERE family_id = v_token.family_id AND status <> 'revoked';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.oauth_grants
     SET status = 'revoked', revoked_at = now(), revoked_reason = 'client_revocation'
   WHERE id = v_token.grant_id AND status = 'active';

  INSERT INTO public.oauth_access_token_revocations (grant_id, reason, expires_at)
  VALUES (v_token.grant_id, 'client_revocation', now() + interval '1 day');

  RETURN QUERY SELECT v_count;
END;
$$;

-- ---------- kjørerettigheter: kun serversiden ----------
REVOKE ALL ON FUNCTION public.oauth_redeem_authorization_code(text, uuid, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oauth_rotate_refresh_token(text, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oauth_revoke_grants(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oauth_revoke_refresh_token(text, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.oauth_redeem_authorization_code(text, uuid, text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.oauth_rotate_refresh_token(text, uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.oauth_revoke_grants(uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.oauth_revoke_refresh_token(text, uuid) TO service_role;

COMMENT ON FUNCTION public.oauth_redeem_authorization_code(text, uuid, text, text, text, timestamptz)
  IS 'Atomisk innløsning av authorization code med PKCE-kontroll, grant-oppretting og første refresh token.';
COMMENT ON FUNCTION public.oauth_rotate_refresh_token(text, uuid, text, timestamptz)
  IS 'Atomisk rotasjon av refresh token. Gjenbruk trekker hele familien og grantet.';
COMMENT ON FUNCTION public.oauth_revoke_grants(uuid, uuid, uuid, text)
  IS 'Trekker grant(er) og tilhørende refresh tokens. Brukes også ved frakobling av integrasjonen.';
COMMENT ON FUNCTION public.oauth_revoke_refresh_token(text, uuid)
  IS 'RFC 7009-revokering av ett refresh token og familien det tilhører. Idempotent.';