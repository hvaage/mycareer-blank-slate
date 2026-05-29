-- Align company_signal_atoms refresh lifecycle with company_profile_atoms / opportunity_requirement_atoms.

ALTER TABLE public.company_signal_atoms
  ADD COLUMN IF NOT EXISTS source_hash text,
  ADD COLUMN IF NOT EXISTS refreshed_at timestamptz,
  ADD COLUMN IF NOT EXISTS stale_at timestamptz;

COMMENT ON COLUMN public.company_signal_atoms.refreshed_at IS
  'Last time this signal row was reconciled by deterministic target-atom refresh.';
COMMENT ON COLUMN public.company_signal_atoms.stale_at IS
  'When the row was marked inactive because it no longer appears in the latest extraction plan.';
COMMENT ON COLUMN public.company_signal_atoms.source_hash IS
  'Stable hash for idempotent upsert / deactivation (same role as profile atoms).';

-- Composite lookups for refresh by company + hash (partial: only hashed rows).
CREATE INDEX IF NOT EXISTS idx_company_signal_atoms_company_id_source_hash
  ON public.company_signal_atoms (company_id, source_hash)
  WHERE source_hash IS NOT NULL;

NOTIFY pgrst, 'reload schema';
