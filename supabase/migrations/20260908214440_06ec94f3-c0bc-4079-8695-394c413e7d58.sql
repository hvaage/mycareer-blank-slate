-- ============================================================
-- AI-integrasjon fase 2: OAuth 2.1-objekter, distribuert claim-rate
-- og capability-challenges.
--
-- SIKKERHET: alle tabellene er rene serverobjekter. RLS er på og det
-- finnes BEVISST ingen policy for anon/authenticated — de har heller
-- ingen GRANT. Kun service_role (server-side admin-klient) har tilgang.
-- Ingen SECURITY DEFINER-funksjoner innføres.
-- ============================================================

-- ---------- oauth_clients ----------
CREATE TABLE public.oauth_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL UNIQUE,
  client_name text NOT NULL,
  client_type text NOT NULL CHECK (client_type IN ('public', 'confidential')),
  client_secret_hash text,
  redirect_uris text[] NOT NULL CHECK (array_length(redirect_uris, 1) >= 1),
  allowed_scopes text[] NOT NULL CHECK (array_length(allowed_scopes, 1) >= 1),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Konfidensielle klienter må ha hemmelighet; offentlige må ikke ha den.
  CONSTRAINT oauth_clients_secret_matches_type CHECK (
    (client_type = 'confidential' AND client_secret_hash IS NOT NULL)
    OR (client_type = 'public' AND client_secret_hash IS NULL)
  )
);

GRANT ALL ON public.oauth_clients TO service_role;
ALTER TABLE public.oauth_clients ENABLE ROW LEVEL SECURITY;

-- ---------- oauth_grants ----------
CREATE TABLE public.oauth_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ai_integration_id uuid NOT NULL REFERENCES public.ai_integrations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.oauth_clients(id) ON DELETE CASCADE,
  scopes text[] NOT NULL CHECK (array_length(scopes, 1) >= 1),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oauth_grants_revoked_consistent CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL)
    OR (status = 'active' AND revoked_at IS NULL)
  )
);

CREATE UNIQUE INDEX oauth_grants_active_unique
  ON public.oauth_grants (user_id, ai_integration_id, client_id)
  WHERE status = 'active';
CREATE INDEX oauth_grants_user_idx ON public.oauth_grants (user_id);
CREATE INDEX oauth_grants_integration_idx ON public.oauth_grants (ai_integration_id);

GRANT ALL ON public.oauth_grants TO service_role;
ALTER TABLE public.oauth_grants ENABLE ROW LEVEL SECURITY;

-- ---------- oauth_authorization_codes ----------
-- Bare hash lagres. PKCE S256 er påkrevd. 60 sekunders levetid.
CREATE TABLE public.oauth_authorization_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL UNIQUE,
  client_id uuid NOT NULL REFERENCES public.oauth_clients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  ai_integration_id uuid REFERENCES public.ai_integrations(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  scopes text[] NOT NULL CHECK (array_length(scopes, 1) >= 1),
  code_challenge text NOT NULL,
  code_challenge_method text NOT NULL DEFAULT 'S256' CHECK (code_challenge_method = 'S256'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_authorization_codes_expiry_idx
  ON public.oauth_authorization_codes (expires_at);

GRANT ALL ON public.oauth_authorization_codes TO service_role;
ALTER TABLE public.oauth_authorization_codes ENABLE ROW LEVEL SECURITY;

-- ---------- oauth_refresh_tokens ----------
-- Bare hash lagres. Rotasjon skjer innenfor en familie; gjenbruk av et
-- forbrukt token oppdages og skal føre til at hele familien trekkes.
CREATE TABLE public.oauth_refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  grant_id uuid NOT NULL REFERENCES public.oauth_grants(id) ON DELETE CASCADE,
  family_id uuid NOT NULL,
  parent_id uuid REFERENCES public.oauth_refresh_tokens(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'consumed', 'revoked')),
  reuse_detected_at timestamptz,
  consumed_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oauth_refresh_tokens_status_consistent CHECK (
    (status = 'active' AND consumed_at IS NULL AND revoked_at IS NULL)
    OR (status = 'consumed' AND consumed_at IS NOT NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX oauth_refresh_tokens_family_idx ON public.oauth_refresh_tokens (family_id);
CREATE INDEX oauth_refresh_tokens_grant_idx ON public.oauth_refresh_tokens (grant_id);
CREATE INDEX oauth_refresh_tokens_expiry_idx ON public.oauth_refresh_tokens (expires_at);

GRANT ALL ON public.oauth_refresh_tokens TO service_role;
ALTER TABLE public.oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;

-- ---------- oauth_access_token_revocations ----------
-- Signerte access tokens kan trekkes tilbake enten på jti eller på grant.
CREATE TABLE public.oauth_access_token_revocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jti text,
  grant_id uuid REFERENCES public.oauth_grants(id) ON DELETE CASCADE,
  reason text,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  -- Rader kan ryddes når det underliggende tokenet uansett er utløpt.
  expires_at timestamptz NOT NULL,
  CONSTRAINT oauth_access_token_revocations_target CHECK (
    jti IS NOT NULL OR grant_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX oauth_access_token_revocations_jti_unique
  ON public.oauth_access_token_revocations (jti) WHERE jti IS NOT NULL;
CREATE INDEX oauth_access_token_revocations_grant_idx
  ON public.oauth_access_token_revocations (grant_id);
CREATE INDEX oauth_access_token_revocations_expiry_idx
  ON public.oauth_access_token_revocations (expires_at);

GRANT ALL ON public.oauth_access_token_revocations TO service_role;
ALTER TABLE public.oauth_access_token_revocations ENABLE ROW LEVEL SECURITY;

-- ---------- claim_rate_events ----------
-- Distribuert ratebegrensning for aktiveringsforsøk.
-- INGEN persondata: kilden lagres kun som HMAC-hash (64 heks-tegn).
CREATE TABLE public.claim_rate_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX claim_rate_events_source_time_idx
  ON public.claim_rate_events (source_hash, occurred_at DESC);
CREATE INDEX claim_rate_events_time_idx ON public.claim_rate_events (occurred_at);

GRANT ALL ON public.claim_rate_events TO service_role;
ALTER TABLE public.claim_rate_events ENABLE ROW LEVEL SECURITY;

-- ---------- capability_challenges ----------
-- Serverkontrollert verifisering av én egenskap om gangen.
CREATE TABLE public.capability_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ai_integration_id uuid NOT NULL REFERENCES public.ai_integrations(id) ON DELETE CASCADE,
  capability text NOT NULL CHECK (
    capability IN ('background_execution', 'scheduled_runs', 'email_forward_or_send')
  ),
  nonce_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'observed', 'completed', 'failed', 'expired')),
  expires_at timestamptz NOT NULL,
  observed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capability_challenges_completed_consistent CHECK (
    status <> 'completed' OR (observed_at IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX capability_challenges_pending_unique
  ON public.capability_challenges (ai_integration_id, capability)
  WHERE status = 'pending';
CREATE INDEX capability_challenges_user_idx ON public.capability_challenges (user_id);
CREATE INDEX capability_challenges_expiry_idx ON public.capability_challenges (expires_at);

GRANT ALL ON public.capability_challenges TO service_role;
ALTER TABLE public.capability_challenges ENABLE ROW LEVEL SECURITY;

-- ---------- updated_at-triggere ----------
CREATE TRIGGER update_oauth_clients_updated_at
  BEFORE UPDATE ON public.oauth_clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_oauth_grants_updated_at
  BEFORE UPDATE ON public.oauth_grants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_capability_challenges_updated_at
  BEFORE UPDATE ON public.capability_challenges
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- eksplisitt sperre mot Data API ----------
REVOKE ALL ON public.oauth_clients FROM anon, authenticated;
REVOKE ALL ON public.oauth_grants FROM anon, authenticated;
REVOKE ALL ON public.oauth_authorization_codes FROM anon, authenticated;
REVOKE ALL ON public.oauth_refresh_tokens FROM anon, authenticated;
REVOKE ALL ON public.oauth_access_token_revocations FROM anon, authenticated;
REVOKE ALL ON public.claim_rate_events FROM anon, authenticated;
REVOKE ALL ON public.capability_challenges FROM anon, authenticated;