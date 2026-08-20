CREATE OR REPLACE FUNCTION public.linkedin_import_heartbeat(
  p_attempt_id uuid, p_lease_owner text, p_phase text DEFAULT NULL,
  p_cursor jsonb DEFAULT NULL, p_processed_files integer DEFAULT NULL,
  p_processed_rows integer DEFAULT NULL, p_staged_records integer DEFAULT NULL,
  p_lease_seconds integer DEFAULT 180)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.linkedin_import_attempts;
BEGIN
  UPDATE public.linkedin_import_attempts a
     SET heartbeat_at = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         phase = coalesce(p_phase, a.phase),
         cursor_json = coalesce(p_cursor, a.cursor_json),
         processed_files_count = coalesce(p_processed_files, a.processed_files_count),
         processed_rows_count = coalesce(p_processed_rows, a.processed_rows_count),
         staged_records_count = coalesce(p_staged_records, a.staged_records_count)
   WHERE a.id = p_attempt_id AND a.status = 'running' AND a.lease_owner = p_lease_owner
  RETURNING * INTO v_row;

  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.linkedin_imports
     SET heartbeat_at = now(),
         active_phase = v_row.phase,
         status = CASE v_row.phase
                    WHEN 'validating_archive' THEN 'validating'
                    WHEN 'staging' THEN 'validated'
                    WHEN 'reconciling' THEN 'staged'
                    ELSE status END
   WHERE id = v_row.linkedin_import_id;

  RETURN v_row.cancellation_requested_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.linkedin_import_heartbeat(uuid,text,text,jsonb,integer,integer,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.linkedin_import_heartbeat(uuid,text,text,jsonb,integer,integer,integer,integer) TO service_role;