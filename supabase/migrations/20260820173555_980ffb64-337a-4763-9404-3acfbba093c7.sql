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
  v_stale_proposals integer := 0;
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

  DELETE FROM public.linkedin_import_stage_records
  WHERE linkedin_import_id = p_import_id;

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

  -- dataminimering av avstemmingsforslag som mistet kildebelegget (samme transaksjon)
  v_stale_proposals := public.linkedin_reconciliation_minimize_stale(v_import.user_id);

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

  DELETE FROM public.linkedin_import_files WHERE linkedin_import_id = p_import_id;
  DELETE FROM public.linkedin_import_purposes WHERE linkedin_import_id = p_import_id;

  IF v_import.archive_available THEN
    INSERT INTO public.linkedin_storage_delete_queue (user_id, linkedin_import_id, object_path)
    VALUES (v_import.user_id, v_import.id,
            v_import.user_id::text || '/' || v_import.id::text || '/archive.zip');
  END IF;

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
    'stale_proposals', v_stale_proposals,
    'canonical_reassigned_to', v_replacement
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.linkedin_import_delete(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.linkedin_import_delete(uuid, text) TO service_role;