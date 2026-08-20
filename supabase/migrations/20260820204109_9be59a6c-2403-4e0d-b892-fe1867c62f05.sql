-- =====================================================================
-- Leveranse A: varig kø-, forsøks- og varslingsmodell for LinkedIn-import
-- =====================================================================

-- 1. Kolonner på linkedin_imports -------------------------------------
ALTER TABLE public.linkedin_imports
  ADD COLUMN IF NOT EXISTS archive_storage_path text,
  ADD COLUMN IF NOT EXISTS last_attempt_id uuid;

-- Eksisterende importer har aldri hatt ZIP lagret i Storage.
UPDATE public.linkedin_imports
   SET archive_available = false
 WHERE archive_storage_path IS NULL AND archive_available = true;

ALTER TABLE public.linkedin_imports
  ADD CONSTRAINT linkedin_imports_archive_path_required
  CHECK (archive_available = false OR archive_storage_path IS NOT NULL);

-- 2. Forsøkstabell -----------------------------------------------------
CREATE TABLE public.linkedin_import_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  linkedin_import_id uuid NOT NULL REFERENCES public.linkedin_imports(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','partially_succeeded','failed','cancelled','expired')),
  phase text NOT NULL DEFAULT 'queued'
    CHECK (phase IN ('queued','validating_archive','staging','reconciling','finalizing')),
  cursor_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  retry_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  processed_files_count integer NOT NULL DEFAULT 0,
  processed_rows_count integer NOT NULL DEFAULT 0,
  staged_records_count integer NOT NULL DEFAULT 0,
  reconciliation_runs_count integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  cancellation_requested_at timestamptz,
  error_code text,
  error_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (linkedin_import_id, attempt_number)
);

CREATE UNIQUE INDEX linkedin_import_attempts_one_active
  ON public.linkedin_import_attempts (linkedin_import_id)
  WHERE status IN ('queued','running');

CREATE INDEX linkedin_import_attempts_claim
  ON public.linkedin_import_attempts (next_retry_at)
  WHERE status = 'queued';

CREATE INDEX linkedin_import_attempts_reap
  ON public.linkedin_import_attempts (lease_expires_at)
  WHERE status = 'running';

CREATE INDEX linkedin_import_attempts_user
  ON public.linkedin_import_attempts (user_id, created_at DESC);

GRANT SELECT ON public.linkedin_import_attempts TO authenticated;
GRANT ALL ON public.linkedin_import_attempts TO service_role;

ALTER TABLE public.linkedin_import_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Eier kan lese egne importforsok"
  ON public.linkedin_import_attempts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Avsluttede forsøk er immutable.
CREATE OR REPLACE FUNCTION public.linkedin_import_attempts_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status IN ('succeeded','partially_succeeded','failed','cancelled','expired') THEN
    RAISE EXCEPTION 'linkedin_import_attempts: avsluttet forsok kan ikke endres (%).', OLD.status;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER linkedin_import_attempts_guard_trg
  BEFORE UPDATE ON public.linkedin_import_attempts
  FOR EACH ROW EXECUTE FUNCTION public.linkedin_import_attempts_guard();

-- 3. Varsler -----------------------------------------------------------
CREATE TABLE public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  notification_kind text NOT NULL
    CHECK (notification_kind IN ('import_completed','import_partially_completed','import_failed_terminal')),
  linkedin_import_id uuid REFERENCES public.linkedin_imports(id) ON DELETE CASCADE,
  attempt_id uuid,
  title text NOT NULL,
  body text NOT NULL,
  deep_link text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX user_notifications_import_kind_unique
  ON public.user_notifications (user_id, linkedin_import_id, notification_kind)
  WHERE linkedin_import_id IS NOT NULL;

CREATE INDEX user_notifications_unread
  ON public.user_notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

GRANT SELECT, UPDATE ON public.user_notifications TO authenticated;
GRANT ALL ON public.user_notifications TO service_role;

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Eier kan lese egne varsler"
  ON public.user_notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Eier kan markere eget varsel som lest"
  ON public.user_notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id AND read_at IS NULL)
  WITH CHECK (auth.uid() = user_id AND read_at IS NOT NULL);

-- Kun read_at kan endres, og kun NULL -> now(). Alt annet er immutabelt.
CREATE OR REPLACE FUNCTION public.user_notifications_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.notification_kind IS DISTINCT FROM OLD.notification_kind
     OR NEW.linkedin_import_id IS DISTINCT FROM OLD.linkedin_import_id
     OR NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.deep_link IS DISTINCT FROM OLD.deep_link
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'user_notifications: kun read_at kan endres.';
  END IF;

  IF OLD.read_at IS NOT NULL THEN
    RAISE EXCEPTION 'user_notifications: read_at er allerede satt og kan ikke endres.';
  END IF;

  IF NEW.read_at IS NULL THEN
    RAISE EXCEPTION 'user_notifications: read_at kan ikke nullstilles.';
  END IF;

  NEW.read_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_notifications_guard_trg
  BEFORE UPDATE ON public.user_notifications
  FOR EACH ROW EXECUTE FUNCTION public.user_notifications_guard();
