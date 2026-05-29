ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS linkedin_id text,
  ADD COLUMN IF NOT EXISTS linkedin_headline text,
  ADD COLUMN IF NOT EXISTS linkedin_vanity_url text,
  ADD COLUMN IF NOT EXISTS linkedin_picture_url text,
  ADD COLUMN IF NOT EXISTS linkedin_connected_at timestamptz;