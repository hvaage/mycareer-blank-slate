ALTER TABLE public.linkedin_network_reconciliation_batches
  ADD COLUMN IF NOT EXISTS new_contact_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.linkedin_recommendation_staging
  ADD COLUMN IF NOT EXISTS counterpart_profile_url TEXT;