-- =========================================================
-- LinkedIn-import fase 2, del 3: sletting og retention
-- =========================================================

CREATE TABLE public.linkedin_storage_delete_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  linkedin_import_id uuid,
  object_path text NOT NULL,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text
);

CREATE INDEX linkedin_storage_delete_queue_pending_idx
  ON public.linkedin_storage_delete_queue (enqueued_at)
  WHERE deleted_at IS NULL;

GRANT ALL ON public.linkedin_storage_delete_queue TO service_role;
ALTER TABLE public.linkedin_storage_delete_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "linkedin_storage_delete_queue_service_only"
  ON public.linkedin_storage_delete_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------
-- Kontrollert sletting av én import
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.linkedin_import_delete(
  p_import_id uuid,
  p_reason text DEFAULT 'user_delete'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_import public.linkedin_imports%ROWTYPE;
  v_replacement uuid;
  v_dependents integer;
  v_tombstone_id uuid;
  v_deleted_staging integer := 0;
BEGIN
  IF p_reason NOT IN ('user_delete','retention_purge','system_purge') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_reason');
  END IF;

  SELECT * INTO v_import
  FROM public.linkedin_imports
  WHERE id = p_import_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'import_not_found');
  END IF;

  IF v_import.purged_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_purged', true, 'import_id', p_import_id);
  END IF;

  -- 0. kanonisk import: flytt referanser eller avvis
  SELECT count(*) INTO v_dependents
  FROM public.linkedin_imports
  WHERE canonical_import_id = p_import_id AND id <> p_import_id;

  IF v_dependents > 0 THEN
    SELECT id INTO v_replacement
    FROM public.linkedin_imports
    WHERE user_id = v_import.user_id
      AND id <> p_import_id
      AND purged_at IS NULL
      AND status <> 'cancelled'
    ORDER BY created_at
    LIMIT 1;

    IF v_replacement IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'canonical_import_in_use');
    END IF;

    UPDATE public.linkedin_imports
    SET canonical_import_id = CASE WHEN id = v_replacement THEN NULL ELSE v_replacement END
    WHERE canonical_import_id = p_import_id AND id <> p_import_id;
  END IF;

  -- 1. tombstone for importen (ingen rå LinkedIn-tekst, ingen stagingpayload)
  INSERT INTO public.linkedin_import_tombstones (
    user_id, linkedin_import_id, archive_sha256, contract_version,
    import_created_at, deletion_reason, staged_record_count, purposes
  )
  VALUES (
    v_import.user_id, v_import.id, v_import.archive_sha256, v_import.contract_version,
    v_import.created_at, p_reason, v_import.staged_record_count,
    COALESCE((SELECT array_agg(purpose ORDER BY purpose)
              FROM public.linkedin_import_purposes
              WHERE linkedin_import_id = p_import_id), ARRAY[]::text[])
  )
  RETURNING id INTO v_tombstone_id;

  -- 2. + 3. fjern importens stagingkoblinger
  DELETE FROM public.linkedin_import_stage_records
  WHERE linkedin_import_id = p_import_id;

  -- 4. slett stagingrader uten gjenværende aktiv importkobling (domenerader kaskaderer)
  WITH orphaned AS (
    DELETE FROM public.linkedin_staging_records sr
    WHERE sr.user_id = v_import.user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.linkedin_import_stage_records l
        WHERE l.staging_record_id = sr.id
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_staging FROM orphaned;

  -- 5. reparer referanser for beholdte (delte) stagingrader
  UPDATE public.linkedin_staging_records sr
  SET first_linkedin_import_id = repaired.first_id,
      last_linkedin_import_id = repaired.last_id
  FROM (
    SELECT l.staging_record_id,
           (array_agg(l.linkedin_import_id ORDER BY i.created_at))[1] AS first_id,
           (array_agg(l.linkedin_import_id ORDER BY i.created_at DESC))[1] AS last_id
    FROM public.linkedin_import_stage_records l
    JOIN public.linkedin_imports i ON i.id = l.linkedin_import_id
    GROUP BY l.staging_record_id
  ) AS repaired
  WHERE sr.id = repaired.staging_record_id
    AND (sr.first_linkedin_import_id = p_import_id
         OR sr.last_linkedin_import_id = p_import_id);

  -- 6. filer, formål per fil (kaskade) og importformål
  DELETE FROM public.linkedin_import_files WHERE linkedin_import_id = p_import_id;
  DELETE FROM public.linkedin_import_purposes WHERE linkedin_import_id = p_import_id;

  -- 7. Storage-slettekø
  IF v_import.archive_available THEN
    INSERT INTO public.linkedin_storage_delete_queue (user_id, linkedin_import_id, object_path)
    VALUES (v_import.user_id, v_import.id,
            v_import.user_id::text || '/' || v_import.id::text || '/archive.zip');
  END IF;

  -- 8. endelig tilstand (modell B): historisk rad, blokkerer ikke reimport
  UPDATE public.linkedin_imports
  SET status = 'cancelled',
      purged_at = now(),
      cancelled_at = COALESCE(cancelled_at, now()),
      archive_available = false,
      active_phase = NULL,
      attempt_id = NULL,
      heartbeat_at = NULL,
      canonical_import_id = NULL,
      known_file_count = 0,
      unknown_file_count = 0,
      excluded_file_count = 0,
      valid_file_count = 0,
      invalid_file_count = 0,
      staged_record_count = 0,
      excluded_reason_counts = '{}'::jsonb,
      error_summary = NULL
  WHERE id = p_import_id;

  RETURN jsonb_build_object(
    'ok', true,
    'import_id', p_import_id,
    'tombstone_id', v_tombstone_id,
    'deleted_staging_records', v_deleted_staging,
    'canonical_reassigned_to', v_replacement
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.linkedin_import_delete(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.linkedin_import_delete(uuid, text) TO service_role;

-- ---------------------------------------------------------
-- Retention-sweep
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.linkedin_import_retention_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_archives integer := 0;
  v_timeouts integer := 0;
  v_purged integer := 0;
  v_row record;
BEGIN
  -- 1. ZIP eldre enn 7 dager
  WITH expired AS (
    UPDATE public.linkedin_imports
    SET archive_available = false
    WHERE archive_available = true
      AND created_at < now() - interval '7 days'
    RETURNING id, user_id
  ), queued AS (
    INSERT INTO public.linkedin_storage_delete_queue (user_id, linkedin_import_id, object_path)
    SELECT user_id, id, user_id::text || '/' || id::text || '/archive.zip' FROM expired
    RETURNING 1
  )
  SELECT count(*) INTO v_archives FROM queued;

  -- 2. importer med utløpt hjerteslag
  UPDATE public.linkedin_imports
  SET active_phase = NULL,
      status = 'failed',
      error_code = 'staging_timeout'
  WHERE active_phase IS NOT NULL
    AND heartbeat_at IS NOT NULL
    AND heartbeat_at < now() - interval '30 minutes';
  GET DIAGNOSTICS v_timeouts = ROW_COUNT;

  -- 3. staging eldre enn 90 dager etter reconciliation_ready purges kontrollert
  FOR v_row IN
    SELECT id FROM public.linkedin_imports
    WHERE purged_at IS NULL
      AND status = 'reconciliation_ready'
      AND staged_at IS NOT NULL
      AND staged_at < now() - interval '90 days'
  LOOP
    PERFORM public.linkedin_import_delete(v_row.id, 'retention_purge');
    v_purged := v_purged + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'archives_expired', v_archives,
    'staging_timeouts', v_timeouts,
    'imports_purged', v_purged
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.linkedin_import_retention_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.linkedin_import_retention_sweep() TO service_role;