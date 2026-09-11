ALTER TABLE public.inbound_email_deliveries
  DROP CONSTRAINT IF EXISTS inbound_email_deliveries_provider_check;

ALTER TABLE public.inbound_email_deliveries
  ADD CONSTRAINT inbound_email_deliveries_provider_check
  CHECK (provider = ANY (ARRAY['lovable'::text, 'mailgun'::text, 'resend'::text]));