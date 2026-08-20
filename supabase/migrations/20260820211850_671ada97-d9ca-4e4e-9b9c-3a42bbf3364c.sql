-- Fase 1: LinkedIn-endorsements som eget tredjepartssignal.

CREATE TYPE public.linkedin_endorsement_direction AS ENUM (
  'received_for_user_skill',
  'given_by_user_to_other',
  'unknown'
);

CREATE TABLE public.linkedin_endorsement_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  linkedin_import_id uuid NOT NULL REFERENCES public.linkedin_imports(id) ON DELETE CASCADE,
  source_file text NOT NULL,
  source_row_number integer NOT NULL,
  source_row_hash text NOT NULL,
  source_classification public.linkedin_staging_classification NOT NULL DEFAULT 'A',
  direction public.linkedin_endorsement_direction NOT NULL,
  skill_source_label text,
  skill_canonical_key text,
  endorser_identity_hash text, -- keyed hash, aldri navn/URL
  observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.linkedin_endorsement_staging TO authenticated;
GRANT ALL ON public.linkedin_endorsement_staging TO service_role;
ALTER TABLE public.linkedin_endorsement_staging ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own endorsement staging"
  ON public.linkedin_endorsement_staging
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE UNIQUE INDEX linkedin_endorsement_staging_identity_idx
  ON public.linkedin_endorsement_staging (user_id, linkedin_import_id, source_row_hash);

CREATE TABLE public.linkedin_endorsement_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  career_atom_id uuid REFERENCES public.career_atoms(id) ON DELETE SET NULL,
  skill_canonical_key text,
  endorsement_count integer NOT NULL DEFAULT 0 CHECK (endorsement_count >= 0),
  source_system text NOT NULL,
  source_classification text NOT NULL,
  source_import_id uuid REFERENCES public.linkedin_imports(id) ON DELETE SET NULL,
  source_hash text,
  observed_at timestamptz,
  promoted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT linkedin_endorsement_signals_target_check
    CHECK (career_atom_id IS NOT NULL OR skill_canonical_key IS NOT NULL)
);

GRANT SELECT ON public.linkedin_endorsement_signals TO authenticated;
GRANT ALL ON public.linkedin_endorsement_signals TO service_role;
ALTER TABLE public.linkedin_endorsement_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own endorsement signals"
  ON public.linkedin_endorsement_signals
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE UNIQUE INDEX linkedin_endorsement_signals_active_idx
  ON public.linkedin_endorsement_signals (user_id, COALESCE(career_atom_id::text, ''), skill_canonical_key)
  WHERE archived_at IS NULL;

-- Trigger: oppdater updated_at
CREATE OR REPLACE FUNCTION public._linkedin_endorsement_staging_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER linkedin_endorsement_staging_set_updated_at
  BEFORE UPDATE ON public.linkedin_endorsement_staging
  FOR EACH ROW EXECUTE FUNCTION public._linkedin_endorsement_staging_set_updated_at();

CREATE OR REPLACE FUNCTION public._linkedin_endorsement_signals_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER linkedin_endorsement_signals_set_updated_at
  BEFORE UPDATE ON public.linkedin_endorsement_signals
  FOR EACH ROW EXECUTE FUNCTION public._linkedin_endorsement_signals_set_updated_at();

REVOKE ALL ON FUNCTION public._linkedin_endorsement_staging_set_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._linkedin_endorsement_staging_set_updated_at() TO service_role;
REVOKE ALL ON FUNCTION public._linkedin_endorsement_signals_set_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._linkedin_endorsement_signals_set_updated_at() TO service_role;