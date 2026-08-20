CREATE OR REPLACE FUNCTION public.linkedin_import_yield_attempt(
  p_attempt_id uuid, p_lease_owner text, p_phase text, p_cursor jsonb,
  p_processed_files integer DEFAULT NULL, p_staged_records integer DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.linkedin_import_attempts;
BEGIN
  UPDATE public.linkedin_import_attempts a
     SET status = 'queued', phase = coalesce(p_phase, a.phase),
         cursor_json = coalesce(p_cursor, a.cursor_json),
         processed_files_count = coalesce(p_processed_files, a.processed_files_count),
         staged_records_count = coalesce(p_staged_records, a.staged_records_count),
         lease_owner = NULL, lease_expires_at = NULL,
         next_retry_at = now(), heartbeat_at = now()
   WHERE a.id = p_attempt_id AND a.status = 'running' AND a.lease_owner = p_lease_owner
  RETURNING * INTO v_row;

  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.linkedin_imports
     SET heartbeat_at = now(), active_phase = v_row.phase
   WHERE id = v_row.linkedin_import_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.linkedin_import_yield_attempt(uuid,text,text,jsonb,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.linkedin_import_yield_attempt(uuid,text,text,jsonb,integer,integer) TO service_role;
