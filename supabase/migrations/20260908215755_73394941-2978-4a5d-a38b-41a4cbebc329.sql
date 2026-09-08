-- ============================================================
-- Fase 2 korrigering: atomisk ratebegrensning, scope-/URI-constraints
-- og eierintegritet.
-- Ingen SECURITY DEFINER. Alle nye funksjoner er SECURITY INVOKER med
-- fast search_path.
-- ============================================================

-- ---------- 1. Atomisk distribuert ratebegrensning ----------
-- Advisory transaction lock per source_hash serialiserer samtidige kall
-- for samme kilde. Rydding, registrering og telling skjer i SAMME
-- transaksjon, slik at insert+count-kappløpet forsvinner.
CREATE OR REPLACE FUNCTION public.claim_rate_check(
  p_source_hash text,
  p_max_attempts integer,
  p_window_seconds integer,
  p_retention_seconds integer
)
RETURNS TABLE (allowed boolean, attempts integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_count integer;
BEGIN
  IF p_source_hash !~ '^[0-9a-f]{64}$'
     OR p_max_attempts IS NULL OR p_max_attempts < 1
     OR p_window_seconds IS NULL OR p_window_seconds < 1
     OR p_retention_seconds IS NULL OR p_retention_seconds < 1 THEN
    RAISE EXCEPTION 'invalid_rate_input';
  END IF;

  -- Lås per kilde for resten av transaksjonen.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_source_hash, 0));

  DELETE FROM public.claim_rate_events
  WHERE occurred_at < v_now - make_interval(secs => p_retention_seconds);

  INSERT INTO public.claim_rate_events (source_hash, occurred_at)
  VALUES (p_source_hash, v_now);

  SELECT count(*)::integer INTO v_count
  FROM public.claim_rate_events
  WHERE source_hash = p_source_hash
    AND occurred_at >= v_now - make_interval(secs => p_window_seconds);

  RETURN QUERY SELECT (v_count <= p_max_attempts), v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_rate_check(text, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_rate_check(text, integer, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rate_check(text, integer, integer, integer) TO service_role;

-- ---------- 2. Scope- og URI-validering ----------
-- Rene, immutable hjelpefunksjoner uten datatilgang. Brukes i CHECK.
CREATE OR REPLACE FUNCTION public.oauth_is_valid_scope_set(p_scopes text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_scopes IS NOT NULL
     AND cardinality(p_scopes) >= 1
     AND array_position(p_scopes, NULL) IS NULL
     AND p_scopes <@ ARRAY['karriere.status.read', 'karriere.workflow.run']::text[]
     AND cardinality(p_scopes) = (SELECT count(DISTINCT s) FROM unnest(p_scopes) AS s);
$$;

CREATE OR REPLACE FUNCTION public.oauth_is_valid_uri_set(p_uris text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_uris IS NOT NULL
     AND cardinality(p_uris) >= 1
     AND array_position(p_uris, NULL) IS NULL
     AND NOT EXISTS (SELECT 1 FROM unnest(p_uris) AS u WHERE btrim(u) = '')
     AND cardinality(p_uris) = (SELECT count(DISTINCT u) FROM unnest(p_uris) AS u);
$$;

ALTER TABLE public.oauth_clients
  DROP CONSTRAINT IF EXISTS oauth_clients_allowed_scopes_check,
  ADD CONSTRAINT oauth_clients_allowed_scopes_valid
    CHECK (public.oauth_is_valid_scope_set(allowed_scopes)),
  DROP CONSTRAINT IF EXISTS oauth_clients_redirect_uris_check,
  ADD CONSTRAINT oauth_clients_redirect_uris_valid
    CHECK (public.oauth_is_valid_uri_set(redirect_uris));

ALTER TABLE public.oauth_grants
  DROP CONSTRAINT IF EXISTS oauth_grants_scopes_check,
  ADD CONSTRAINT oauth_grants_scopes_valid
    CHECK (public.oauth_is_valid_scope_set(scopes));

ALTER TABLE public.oauth_authorization_codes
  DROP CONSTRAINT IF EXISTS oauth_authorization_codes_scopes_check,
  ADD CONSTRAINT oauth_authorization_codes_scopes_valid
    CHECK (public.oauth_is_valid_scope_set(scopes));

-- ---------- 3. Eierintegritet ----------
-- Sammensatt FK krever unik (id, user_id) på ai_integrations.
ALTER TABLE public.ai_integrations
  ADD CONSTRAINT ai_integrations_id_user_id_key UNIQUE (id, user_id);

-- oauth_grants: user_id MÅ være eieren av integrasjonen.
ALTER TABLE public.oauth_grants
  DROP CONSTRAINT oauth_grants_ai_integration_id_fkey,
  ADD CONSTRAINT oauth_grants_integration_owner_fkey
    FOREIGN KEY (ai_integration_id, user_id)
    REFERENCES public.ai_integrations(id, user_id) ON DELETE CASCADE,
  ADD CONSTRAINT oauth_grants_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- capability_challenges: samme regel.
ALTER TABLE public.capability_challenges
  DROP CONSTRAINT capability_challenges_ai_integration_id_fkey,
  ADD CONSTRAINT capability_challenges_integration_owner_fkey
    FOREIGN KEY (ai_integration_id, user_id)
    REFERENCES public.ai_integrations(id, user_id) ON DELETE CASCADE,
  ADD CONSTRAINT capability_challenges_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- oauth_authorization_codes: ai_integration_id er valgfri. MATCH SIMPLE
-- gjør at eierkravet håndheves når og bare når integrasjon er satt.
ALTER TABLE public.oauth_authorization_codes
  DROP CONSTRAINT oauth_authorization_codes_ai_integration_id_fkey,
  ADD CONSTRAINT oauth_authorization_codes_integration_owner_fkey
    FOREIGN KEY (ai_integration_id, user_id)
    REFERENCES public.ai_integrations(id, user_id) MATCH SIMPLE ON DELETE CASCADE,
  ADD CONSTRAINT oauth_authorization_codes_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

COMMENT ON CONSTRAINT oauth_grants_integration_owner_fkey ON public.oauth_grants IS
  'user_id kan ikke avvike fra eieren av ai_integration_id. ON DELETE CASCADE.';
COMMENT ON CONSTRAINT capability_challenges_integration_owner_fkey ON public.capability_challenges IS
  'user_id kan ikke avvike fra eieren av ai_integration_id. ON DELETE CASCADE.';
COMMENT ON CONSTRAINT oauth_authorization_codes_integration_owner_fkey ON public.oauth_authorization_codes IS
  'Håndheves når ai_integration_id er satt (MATCH SIMPLE). ON DELETE CASCADE.';
COMMENT ON FUNCTION public.claim_rate_check(text, integer, integer, integer) IS
  'Atomisk ratebegrensning for aktiveringsforsøk. SECURITY INVOKER, kun service_role.';