-- Additive: audit trail for inbound email deliveries + alias token format hardening.

-- 1. Ownership anchor for composite foreign keys.
CREATE UNIQUE INDEX IF NOT EXISTS email_job_sources_user_id_id_key
  ON public.email_job_sources (user_id, id);

-- 2. Opaque alias token format (lowercase base32, 26-64 chars).
ALTER TABLE public.email_job_sources
  ADD CONSTRAINT email_job_sources_inbound_alias_token_format
  CHECK (inbound_alias_token IS NULL OR inbound_alias_token ~ '^[a-z2-7]{26,64}$');

-- 3. Delivery audit table.
CREATE TABLE public.inbound_email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_job_source_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('lovable', 'mailgun')),
  provider_message_id text NOT NULL CHECK (length(provider_message_id) BETWEEN 1 AND 512),
  alias_token text NOT NULL CHECK (alias_token ~ '^[a-z2-7]{26,64}$'),
  from_domain text,
  size_bytes integer CHECK (size_bytes IS NULL OR size_bytes >= 0),
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'duplicate', 'parse_failed', 'ingest_failed')),
  reject_reason text,
  imported_job_email_id uuid,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbound_email_deliveries_source_fkey
    FOREIGN KEY (user_id, email_job_source_id)
    REFERENCES public.email_job_sources (user_id, id) ON DELETE CASCADE,
  CONSTRAINT inbound_email_deliveries_email_fkey
    FOREIGN KEY (user_id, imported_job_email_id)
    REFERENCES public.imported_job_emails (user_id, id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX inbound_email_deliveries_idempotency_idx
  ON public.inbound_email_deliveries (email_job_source_id, provider, provider_message_id);

CREATE INDEX inbound_email_deliveries_user_received_idx
  ON public.inbound_email_deliveries (user_id, received_at DESC);

GRANT SELECT ON public.inbound_email_deliveries TO authenticated;
GRANT ALL ON public.inbound_email_deliveries TO service_role;

ALTER TABLE public.inbound_email_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own inbound deliveries"
  ON public.inbound_email_deliveries
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER update_inbound_email_deliveries_updated_at
  BEFORE UPDATE ON public.inbound_email_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.inbound_email_deliveries IS
  'Revisjonsspor for innkommende jobb-e-post. Inneholder aldri e-postinnhold, kun metadata og utfall.';