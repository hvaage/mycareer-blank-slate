-- Retting: OUT-parameteret family_id kolliderte med kolonnenavnet i
-- UPDATE-setningen ved replay. Tabellen aliases nå eksplisitt.
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

  SELECT * INTO v_client FROM public.oauth_clients c WHERE c.id = p_client_row_id;
  IF NOT FOUND OR v_client.is_active = false
     OR (v_client.expires_at IS NOT NULL AND v_client.expires_at <= now()) THEN
    RETURN QUERY SELECT false, 'client_unusable', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_token FROM public.oauth_refresh_tokens t
   WHERE t.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'unknown_token', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_grant FROM public.oauth_grants g WHERE g.id = v_token.grant_id FOR UPDATE;

  IF v_token.status <> 'active' THEN
    -- Replay: kun tokenfamilien trekkes. Grantet og andre grants står.
    UPDATE public.oauth_refresh_tokens t
       SET status = 'revoked', revoked_at = now(),
           reuse_detected_at = COALESCE(t.reuse_detected_at, now())
     WHERE t.family_id = v_token.family_id AND t.status <> 'revoked';

    INSERT INTO public.oauth_security_events (event_type, client_row_id, grant_id, user_id, detail)
    VALUES ('refresh_token_reuse', p_client_row_id, v_token.grant_id, v_grant.user_id,
            jsonb_build_object('family_revoked', true, 'grant_revoked', false));

    RETURN QUERY SELECT false, 'reuse_detected', NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text[], NULL::uuid;
    RETURN;
  END IF;

  IF v_token.expires_at <= now() THEN
    UPDATE public.oauth_refresh_tokens t SET status = 'revoked', revoked_at = now() WHERE t.id = v_token.id;
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

  UPDATE public.oauth_refresh_tokens t SET status = 'consumed', consumed_at = now() WHERE t.id = v_token.id;
  INSERT INTO public.oauth_refresh_tokens (token_hash, grant_id, family_id, parent_id, expires_at)
  VALUES (p_new_token_hash, v_token.grant_id, v_token.family_id, v_token.id, p_new_expires_at);

  UPDATE public.oauth_clients c SET last_used_at = now(), updated_at = now() WHERE c.id = p_client_row_id;

  RETURN QUERY SELECT true, 'ok', v_grant.id, v_grant.user_id, v_grant.ai_integration_id,
                      v_provider, v_grant.scopes, v_token.family_id;
END;
$$;

REVOKE ALL ON FUNCTION public.oauth_rotate_refresh_token_v2(text, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oauth_rotate_refresh_token_v2(text, uuid, text, timestamptz) TO service_role;