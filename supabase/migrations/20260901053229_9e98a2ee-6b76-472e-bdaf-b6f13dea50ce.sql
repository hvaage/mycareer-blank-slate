ALTER TABLE reg.brreg_full_sync_runs
  ADD COLUMN IF NOT EXISTS char_cursor bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.brreg_full_patch_run(p_run_id bigint, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'reg'
AS $function$
DECLARE v jsonb;
BEGIN
  UPDATE reg.brreg_full_sync_runs r SET
    phase              = coalesce(p_patch->>'phase', r.phase),
    status             = coalesce(p_patch->>'status', r.status),
    storage_bucket     = coalesce(p_patch->>'storage_bucket', r.storage_bucket),
    storage_path       = coalesce(p_patch->>'storage_path', r.storage_path),
    expected_bytes     = coalesce((p_patch->>'expected_bytes')::bigint, r.expected_bytes),
    actual_bytes       = coalesce((p_patch->>'actual_bytes')::bigint, r.actual_bytes),
    integrity_ok       = coalesce((p_patch->>'integrity_ok')::boolean, r.integrity_ok),
    integrity_reason   = coalesce(p_patch->>'integrity_reason', r.integrity_reason),
    download_ms        = coalesce((p_patch->>'download_ms')::int, r.download_ms),
    row_cursor         = coalesce((p_patch->>'row_cursor')::bigint, r.row_cursor),
    char_cursor        = coalesce((p_patch->>'char_cursor')::bigint, r.char_cursor),
    rows_seen          = coalesce((p_patch->>'rows_seen')::bigint, r.rows_seen),
    shard_count        = coalesce((p_patch->>'shard_count')::int, r.shard_count),
    parse_complete     = coalesce((p_patch->>'parse_complete')::boolean, r.parse_complete),
    gate_pass          = coalesce((p_patch->>'gate_pass')::boolean, r.gate_pass),
    gate               = coalesce(p_patch->'gate', r.gate),
    error              = coalesce(p_patch->>'error', r.error),
    notes              = coalesce(p_patch->'notes', r.notes),
    finished_at        = CASE WHEN p_patch ? 'finished' THEN now() ELSE r.finished_at END
  WHERE r.id = p_run_id
  RETURNING to_jsonb(r.*) INTO v;
  RETURN v;
END;
$function$;

REVOKE ALL ON FUNCTION public.brreg_full_patch_run(bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brreg_full_patch_run(bigint, jsonb) TO service_role;