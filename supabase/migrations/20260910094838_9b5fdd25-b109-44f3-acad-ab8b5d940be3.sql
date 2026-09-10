CREATE OR REPLACE FUNCTION public.oauth_upsert_cimd_client(
  p_client_id text,
  p_client_name text,
  p_metadata_url text,
  p_redirect_uris text[],
  p_allowed_scopes text[],
  p_metadata_expires_at timestamp with time zone
)
RETURNS TABLE(id uuid, client_id text, client_name text, client_type text, is_active boolean, redirect_uris text[], allowed_scopes text[], registration_method text, metadata_url text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.oauth_clients%ROWTYPE;
  v_codex CONSTANT text := 'https://chatgpt.com/oauth/codex/client.json';
  v_claude CONSTANT text := 'https://claude.ai/oauth/claude-code-client-metadata';
  v_templates CONSTANT text[] := ARRAY['http://127.0.0.1/callback','http://localhost/callback'];
  v_non_https text[];
  v_https text[];
  v_loopback_identity boolean;
BEGIN
  IF p_metadata_url IS NULL OR p_metadata_url NOT LIKE 'https://%' THEN
    RAISE EXCEPTION 'invalid_metadata_url';
  END IF;
  IF NOT public.oauth_is_valid_scope_set(p_allowed_scopes) THEN
    RAISE EXCEPTION 'invalid_client_metadata';
  END IF;
  IF p_redirect_uris IS NULL OR cardinality(p_redirect_uris) < 1
     OR array_position(p_redirect_uris, NULL) IS NOT NULL
     OR cardinality(p_redirect_uris) <> (SELECT count(DISTINCT u) FROM unnest(p_redirect_uris) AS u) THEN
    RAISE EXCEPTION 'invalid_client_metadata';
  END IF;

  SELECT coalesce(array_agg(u), ARRAY[]::text[]) INTO v_non_https
  FROM unnest(p_redirect_uris) AS u
  WHERE u NOT LIKE 'https://%';

  IF cardinality(v_non_https) = 0 THEN
    -- Uendret streng regel for alt annet enn de kjente loopback-dokumentene.
    IF NOT public.oauth_is_valid_uri_set(p_redirect_uris) THEN
      RAISE EXCEPTION 'invalid_client_metadata';
    END IF;
  ELSE
    -- Kun eksakt førstepartsidentitet: client_id = metadata_url = kjent dokument.
    v_loopback_identity := p_client_id = p_metadata_url AND p_client_id IN (v_codex, v_claude);
    IF NOT v_loopback_identity THEN
      RAISE EXCEPTION 'invalid_client_metadata';
    END IF;
    -- Ingen andre ikke-https-adresser enn de to portløse malene.
    IF NOT (v_non_https <@ v_templates) THEN
      RAISE EXCEPTION 'invalid_client_metadata';
    END IF;
    -- Codex må publisere nøyaktig begge malene og ingenting annet.
    IF p_client_id = v_codex
       AND NOT (p_redirect_uris <@ v_templates AND v_templates <@ p_redirect_uris) THEN
      RAISE EXCEPTION 'invalid_client_metadata';
    END IF;
    -- En tillatt loopback-mal gir ALDRI fritak for https-adressene i samme
    -- dokument: den ikke-tomme https-delmengden må bestå den vanlige kontrollen.
    SELECT coalesce(array_agg(u), ARRAY[]::text[]) INTO v_https
    FROM unnest(p_redirect_uris) AS u
    WHERE u LIKE 'https://%';

    IF cardinality(v_https) > 0 AND NOT public.oauth_is_valid_uri_set(v_https) THEN
      RAISE EXCEPTION 'invalid_client_metadata';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id, 45));

  INSERT INTO public.oauth_clients AS c
    (client_id, client_name, client_type, redirect_uris, allowed_scopes,
     registration_method, metadata_url, metadata_validated_at, metadata_expires_at, is_active)
  VALUES
    (p_client_id, p_client_name, 'public', p_redirect_uris, p_allowed_scopes,
     'cimd', p_metadata_url, now(), p_metadata_expires_at, true)
  ON CONFLICT ON CONSTRAINT oauth_clients_client_id_key DO UPDATE
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
$function$;

REVOKE ALL ON FUNCTION public.oauth_upsert_cimd_client(text, text, text, text[], text[], timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.oauth_upsert_cimd_client(text, text, text, text[], text[], timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oauth_upsert_cimd_client(text, text, text, text[], text[], timestamptz) TO service_role;