-- Fase 3 & 3b: Nettverk, selskaper, reimport og varig batch (justert for eksisterende identitestabell).

-- 1. Tilpass eksisterende network_contact_identities til kontrakten.
ALTER TABLE public.network_contact_identities
  ADD COLUMN IF NOT EXISTS identity_value_hash text,
  ADD COLUMN IF NOT EXISTS identity_value_preview text,
  ADD COLUMN IF NOT EXISTS source_system text,
  ADD COLUMN IF NOT EXISTS source_import_id uuid REFERENCES public.linkedin_imports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS first_observed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_observed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Sørg for at identity_kind er begrenset til gyldige verdier.
ALTER TABLE public.network_contact_identities
  DROP CONSTRAINT IF EXISTS network_contact_identities_kind_check;

ALTER TABLE public.network_contact_identities
  ADD CONSTRAINT network_contact_identities_kind_check
  CHECK (identity_kind IN ('linkedin_profile_url'));

-- Relasjon mellom nettverkskontakt og selskap (observasjon, ikke eierskap).
CREATE TABLE public.network_contact_company_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_contact_id uuid NOT NULL REFERENCES public.network_contacts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  company_name_observed text,
  company_name_canonical text,
  relation_kind text NOT NULL CHECK (relation_kind IN ('current_employer','past_employer','affiliation','unknown')),
  source_system text NOT NULL,
  source_import_id uuid REFERENCES public.linkedin_imports(id) ON DELETE SET NULL,
  observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.network_contact_company_relations TO authenticated;
GRANT ALL ON public.network_contact_company_relations TO service_role;
ALTER TABLE public.network_contact_company_relations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own contact company relations"
  ON public.network_contact_company_relations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE UNIQUE INDEX network_contact_company_relations_dedupe_idx
  ON public.network_contact_company_relations (user_id, network_contact_id, COALESCE(company_id::text, ''), relation_kind, source_system);

-- Brukerens relasjon til selskap (eierskap av notater, interesse, etc.).
CREATE TABLE public.user_company_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  company_name_user text,
  relationship_kind text NOT NULL CHECK (relationship_kind IN ('employer','target','client','competitor','partner','other','unknown')),
  notes text,
  source_system text,
  source_import_id uuid REFERENCES public.linkedin_imports(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_company_relationships TO authenticated;
GRANT ALL ON public.user_company_relationships TO service_role;
ALTER TABLE public.user_company_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own company relationships"
  ON public.user_company_relationships
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Utvid network_contacts med LinkedIn-import-id og profil-URL (kun visning).
ALTER TABLE public.network_contacts
  ADD COLUMN IF NOT EXISTS source_import_id uuid REFERENCES public.linkedin_imports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linkedin_profile_url text;

-- Varig nettverksbatch-modell.
CREATE TYPE public.linkedin_network_batch_status AS ENUM (
  'preparing',
  'ready',
  'consumed',
  'superseded'
);

CREATE TYPE public.linkedin_network_batch_item_category AS ENUM (
  'exact_identity_match',
  'possible_duplicate',
  'without_stable_identity',
  'observed_profile_change',
  'excluded'
);

CREATE TYPE public.linkedin_network_batch_item_action AS ENUM (
  'create_contact',
  'merge_into_contact',
  'review_manually',
  'skip'
);

CREATE TYPE public.linkedin_network_batch_item_status AS ENUM (
  'pending',
  'approved',
  'rejected',
  'auto_applied'
);

CREATE TABLE public.linkedin_network_reconciliation_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  linkedin_import_id uuid NOT NULL REFERENCES public.linkedin_imports(id) ON DELETE CASCADE,
  reconciliation_run_id uuid REFERENCES public.linkedin_reconciliation_runs(id) ON DELETE SET NULL,
  input_signature text NOT NULL,
  reconciliation_version text NOT NULL DEFAULT 'linkedin_reconciliation_v2',
  status public.linkedin_network_batch_status NOT NULL DEFAULT 'preparing',
  total_count integer NOT NULL DEFAULT 0,
  exact_identity_match_count integer NOT NULL DEFAULT 0,
  possible_duplicate_count integer NOT NULL DEFAULT 0,
  without_stable_identity_count integer NOT NULL DEFAULT 0,
  observed_profile_change_count integer NOT NULL DEFAULT 0,
  excluded_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  prepared_at timestamptz,
  consumed_at timestamptz,
  superseded_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, input_signature, reconciliation_version)
);

GRANT SELECT ON public.linkedin_network_reconciliation_batches TO authenticated;
GRANT ALL ON public.linkedin_network_reconciliation_batches TO service_role;
ALTER TABLE public.linkedin_network_reconciliation_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own network reconciliation batches"
  ON public.linkedin_network_reconciliation_batches
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE TABLE public.linkedin_network_reconciliation_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.linkedin_network_reconciliation_batches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  staging_record_id uuid REFERENCES public.linkedin_staging_records(id) ON DELETE SET NULL,
  source_identity_hash text,
  category public.linkedin_network_batch_item_category NOT NULL,
  proposed_action public.linkedin_network_batch_item_action NOT NULL,
  target_contact_id uuid REFERENCES public.network_contacts(id) ON DELETE SET NULL,
  status public.linkedin_network_batch_item_status NOT NULL DEFAULT 'pending',
  reason_codes text[] DEFAULT '{}',
  source_hash text,
  observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.linkedin_network_reconciliation_batch_items TO authenticated;
GRANT ALL ON public.linkedin_network_reconciliation_batch_items TO service_role;
ALTER TABLE public.linkedin_network_reconciliation_batch_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own network batch items"
  ON public.linkedin_network_reconciliation_batch_items
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX linkedin_network_batch_items_batch_id_idx
  ON public.linkedin_network_reconciliation_batch_items (batch_id);

-- updated_at triggers
CREATE OR REPLACE FUNCTION public._linkedin_network_batches_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER linkedin_network_batches_set_updated_at
  BEFORE UPDATE ON public.linkedin_network_reconciliation_batches
  FOR EACH ROW EXECUTE FUNCTION public._linkedin_network_batches_set_updated_at();

CREATE OR REPLACE FUNCTION public._linkedin_network_batch_items_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER linkedin_network_batch_items_set_updated_at
  BEFORE UPDATE ON public.linkedin_network_reconciliation_batch_items
  FOR EACH ROW EXECUTE FUNCTION public._linkedin_network_batch_items_set_updated_at();

REVOKE ALL ON FUNCTION public._linkedin_network_batches_set_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._linkedin_network_batches_set_updated_at() TO service_role;
REVOKE ALL ON FUNCTION public._linkedin_network_batch_items_set_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._linkedin_network_batch_items_set_updated_at() TO service_role;