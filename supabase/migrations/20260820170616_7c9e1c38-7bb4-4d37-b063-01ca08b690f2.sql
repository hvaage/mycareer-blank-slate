-- =========================================================
-- LinkedIn-import fase 2, del 1: importlag
-- =========================================================

CREATE TABLE public.linkedin_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  archive_sha256 text NOT NULL,
  content_manifest_hash text,
  contract_version text NOT NULL DEFAULT 'linkedin_import_contract_v1',
  status text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded','validating','validated','partially_validated',
                      'staged','reconciliation_ready','rejected','cancelled','failed')),
  canonical_import_id uuid,
  error_code text,
  error_summary text,
  archive_available boolean NOT NULL,
  active_phase text CHECK (active_phase IN ('validation','staging')),
  attempt_id uuid,
  heartbeat_at timestamptz,
  staging_started_at timestamptz,
  known_file_count integer NOT NULL DEFAULT 0,
  unknown_file_count integer NOT NULL DEFAULT 0,
  excluded_file_count integer NOT NULL DEFAULT 0,
  valid_file_count integer NOT NULL DEFAULT 0,
  invalid_file_count integer NOT NULL DEFAULT 0,
  staged_record_count integer NOT NULL DEFAULT 0,
  excluded_reason_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  staged_at timestamptz,
  cancelled_at timestamptz,
  purged_at timestamptz,
  CONSTRAINT linkedin_imports_id_user_key UNIQUE (id, user_id)
);

ALTER TABLE public.linkedin_imports
  ADD CONSTRAINT linkedin_imports_canonical_fk
  FOREIGN KEY (canonical_import_id, user_id)
  REFERENCES public.linkedin_imports (id, user_id);

-- Partiell unikhet: slettede/purgede importer blokkerer aldri ny import av samme ZIP.
CREATE UNIQUE INDEX linkedin_imports_active_archive_key
  ON public.linkedin_imports (user_id, archive_sha256)
  WHERE purged_at IS NULL AND status <> 'cancelled';

CREATE INDEX linkedin_imports_user_created_idx
  ON public.linkedin_imports (user_id, created_at DESC);

GRANT SELECT ON public.linkedin_imports TO authenticated;
GRANT ALL ON public.linkedin_imports TO service_role;
ALTER TABLE public.linkedin_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "linkedin_imports_owner_select" ON public.linkedin_imports
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------
-- Tombstones: minimalt revisjonsspor, ingen rå LinkedIn-tekst
-- ---------------------------------------------------------
CREATE TABLE public.linkedin_import_tombstones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  linkedin_import_id uuid NOT NULL,
  archive_sha256 text NOT NULL,
  contract_version text NOT NULL,
  import_created_at timestamptz NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  deletion_reason text NOT NULL
    CHECK (deletion_reason IN ('user_delete','retention_purge','system_purge')),
  staged_record_count integer NOT NULL DEFAULT 0,
  purposes text[] NOT NULL DEFAULT ARRAY[]::text[]
);

CREATE INDEX linkedin_import_tombstones_user_idx
  ON public.linkedin_import_tombstones (user_id, deleted_at DESC);

GRANT SELECT ON public.linkedin_import_tombstones TO authenticated;
GRANT ALL ON public.linkedin_import_tombstones TO service_role;
ALTER TABLE public.linkedin_import_tombstones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "linkedin_import_tombstones_owner_select" ON public.linkedin_import_tombstones
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------
-- Behandlingsformål per import
-- ---------------------------------------------------------
CREATE TABLE public.linkedin_import_purposes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  linkedin_import_id uuid NOT NULL,
  user_id uuid NOT NULL,
  purpose text NOT NULL
    CHECK (purpose IN ('profile','career','network','jobs','learning','content')),
  selected_at timestamptz NOT NULL DEFAULT now(),
  selection_source text NOT NULL DEFAULT 'user_input',
  CONSTRAINT linkedin_import_purposes_unique UNIQUE (linkedin_import_id, purpose),
  CONSTRAINT linkedin_import_purposes_import_fk
    FOREIGN KEY (linkedin_import_id, user_id)
    REFERENCES public.linkedin_imports (id, user_id) ON DELETE CASCADE
);

GRANT SELECT ON public.linkedin_import_purposes TO authenticated;
GRANT ALL ON public.linkedin_import_purposes TO service_role;
ALTER TABLE public.linkedin_import_purposes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "linkedin_import_purposes_owner_select" ON public.linkedin_import_purposes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------
-- Importfiler (kun klasse A og B)
-- ---------------------------------------------------------
CREATE TABLE public.linkedin_import_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  linkedin_import_id uuid NOT NULL,
  user_id uuid NOT NULL,
  archive_path text NOT NULL,
  file_class text NOT NULL CHECK (file_class IN ('A','B')),
  file_hash text NOT NULL,
  compressed_bytes bigint,
  uncompressed_bytes bigint,
  status text NOT NULL DEFAULT 'discovered'
    CHECK (status IN ('discovered','validated','partially_validated','invalid')),
  row_count integer,
  valid_row_count integer,
  invalid_row_count integer,
  error_code text,
  parser_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linkedin_import_files_path_unique UNIQUE (linkedin_import_id, archive_path),
  CONSTRAINT linkedin_import_files_id_user_key UNIQUE (id, user_id),
  CONSTRAINT linkedin_import_files_import_fk
    FOREIGN KEY (linkedin_import_id, user_id)
    REFERENCES public.linkedin_imports (id, user_id) ON DELETE CASCADE
);

GRANT SELECT ON public.linkedin_import_files TO authenticated;
GRANT ALL ON public.linkedin_import_files TO service_role;
ALTER TABLE public.linkedin_import_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "linkedin_import_files_owner_select" ON public.linkedin_import_files
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------
-- Formålsutfall per fil
-- ---------------------------------------------------------
CREATE TABLE public.linkedin_import_file_purposes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  linkedin_import_file_id uuid NOT NULL,
  user_id uuid NOT NULL,
  purpose text NOT NULL
    CHECK (purpose IN ('profile','career','network','jobs','learning','content')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','staged','skipped_no_consent','deferred','failed')),
  staged_record_count integer NOT NULL DEFAULT 0,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linkedin_import_file_purposes_unique UNIQUE (linkedin_import_file_id, purpose),
  CONSTRAINT linkedin_import_file_purposes_file_fk
    FOREIGN KEY (linkedin_import_file_id, user_id)
    REFERENCES public.linkedin_import_files (id, user_id) ON DELETE CASCADE
);

GRANT SELECT ON public.linkedin_import_file_purposes TO authenticated;
GRANT ALL ON public.linkedin_import_file_purposes TO service_role;
ALTER TABLE public.linkedin_import_file_purposes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "linkedin_import_file_purposes_owner_select" ON public.linkedin_import_file_purposes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);