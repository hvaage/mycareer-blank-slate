-- Admin ingestion overview for Brreg/Regnskap/NAV.
-- Read-only contract for Admin UI. No sync, cron, secret or lifecycle changes.

CREATE INDEX IF NOT EXISTS idx_source_postings_nav_created_at
  ON public.source_postings (created_at)
  WHERE source = 'nav';

CREATE INDEX IF NOT EXISTS idx_regnskap_hentet_tidspunkt
  ON reg.regnskap (hentet_tidspunkt DESC);

