-- Module 4: deterministic atom refresh — idempotency and lifecycle metadata.

ALTER TABLE public.user_preference_atoms
  ADD COLUMN IF NOT EXISTS source_hash text,
  ADD COLUMN IF NOT EXISTS refreshed_at timestamptz,
  ADD COLUMN IF NOT EXISTS stale_at timestamptz;

ALTER TABLE public.user_evidence_atoms
  ADD COLUMN IF NOT EXISTS source_hash text,
  ADD COLUMN IF NOT EXISTS refreshed_at timestamptz,
  ADD COLUMN IF NOT EXISTS stale_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_user_preference_atoms_user_source_hash
  ON public.user_preference_atoms (user_id, source_hash)
  WHERE source_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_evidence_atoms_user_source_hash
  ON public.user_evidence_atoms (user_id, source_hash)
  WHERE source_hash IS NOT NULL;

COMMENT ON COLUMN public.user_preference_atoms.source_hash IS
  'Stable hash of source + source_field + dimension + label/value for idempotent system refresh.';
COMMENT ON COLUMN public.user_evidence_atoms.source_hash IS
  'Stable hash of source + source_field + category + label for idempotent system refresh.';

NOTIFY pgrst, 'reload schema';
