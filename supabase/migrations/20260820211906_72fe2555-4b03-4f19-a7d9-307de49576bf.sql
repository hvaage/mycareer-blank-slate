-- Fase 2: Anbefalinger med retning og proveniens.

CREATE TYPE public.career_recommendation_direction AS ENUM (
  'received',
  'given'
);

ALTER TABLE public.career_recommendations
  ADD COLUMN IF NOT EXISTS direction public.career_recommendation_direction,
  ADD COLUMN IF NOT EXISTS source_system text,
  ADD COLUMN IF NOT EXISTS source_classification text,
  ADD COLUMN IF NOT EXISTS source_import_id uuid,
  ADD COLUMN IF NOT EXISTS source_hash text,
  ADD COLUMN IF NOT EXISTS recommended_on date,
  ADD COLUMN IF NOT EXISTS author_identity_hash text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Kun mottatte anbefalinger kan ligge i produktlaget.
ALTER TABLE public.career_recommendations
  ADD CONSTRAINT career_recommendations_direction_check
  CHECK (direction IS NULL OR direction = 'received');

-- Forfatteridentitet kreves for mottatte anbefalinger.
ALTER TABLE public.career_recommendations
  ADD CONSTRAINT career_recommendations_author_hash_check
  CHECK (direction <> 'received' OR author_identity_hash IS NOT NULL);

-- Deduplisering på bruker + forfatteridentitet + teksthash + kildesystem.
CREATE UNIQUE INDEX IF NOT EXISTS career_recommendations_dedupe_idx
  ON public.career_recommendations (user_id, author_identity_hash, text_hash, source_system)
  WHERE direction = 'received' AND archived_at IS NULL;

-- RLS policy finnes allerede; verifiser at kolonnene er riktige.
SELECT 1;