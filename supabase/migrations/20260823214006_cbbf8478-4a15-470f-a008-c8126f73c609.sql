CREATE TABLE public.inbound_email_rate_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash text NOT NULL,
  alias_token text,
  outcome text NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending', 'accepted', 'unknown_alias', 'rejected', 'rate_limited')),
  event_hour timestamptz NOT NULL DEFAULT date_trunc('hour', now()),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.inbound_email_rate_events TO service_role;

ALTER TABLE public.inbound_email_rate_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only"
  ON public.inbound_email_rate_events
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

CREATE INDEX idx_inbound_rate_events_alias_hour
  ON public.inbound_email_rate_events (alias_token, event_hour);

CREATE INDEX idx_inbound_rate_events_ip_hash_hour
  ON public.inbound_email_rate_events (ip_hash, event_hour);

CREATE INDEX idx_inbound_rate_events_outcome_hour
  ON public.inbound_email_rate_events (outcome, event_hour);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_inbound_email_rate_events_updated_at
BEFORE UPDATE ON public.inbound_email_rate_events
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();