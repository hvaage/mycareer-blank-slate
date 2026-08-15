CREATE OR REPLACE FUNCTION public.brreg_full_stage_batch(
  p_run_id bigint,
  p_rows jsonb,
  p_excluded jsonb,
  p_row_cursor bigint,
  p_rows_seen bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, reg
AS $$
DECLARE staged int := 0; excluded int := 0;
BEGIN
  IF jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 0 THEN
    WITH src AS (
      SELECT (jsonb_populate_record(
                NULL::reg.brreg_full_staging,
                r || jsonb_build_object('run_id', p_run_id)
              )).* 
      FROM jsonb_array_elements(p_rows) r
    ), ins AS (
      INSERT INTO reg.brreg_full_staging SELECT * FROM src
      ON CONFLICT (run_id, organisasjonsnummer) DO NOTHING
      RETURNING 1
    ) SELECT count(*) INTO staged FROM ins;
  END IF;

  IF jsonb_array_length(coalesce(p_excluded, '[]'::jsonb)) > 0 THEN
    WITH src AS (
      SELECT * FROM jsonb_to_recordset(p_excluded) AS x(organisasjonsnummer text, reason text)
    ), ins AS (
      INSERT INTO reg.brreg_full_excluded (run_id, organisasjonsnummer, reason)
      SELECT p_run_id, organisasjonsnummer, reason FROM src
      ON CONFLICT (run_id, organisasjonsnummer) DO NOTHING
      RETURNING 1
    ) SELECT count(*) INTO excluded FROM ins;
  END IF;

  UPDATE reg.brreg_full_sync_runs r
     SET row_cursor    = p_row_cursor,
         rows_seen     = p_rows_seen,
         rows_staged   = r.rows_staged + staged,
         rows_excluded = r.rows_excluded + excluded
   WHERE r.id = p_run_id;

  RETURN jsonb_build_object('staged', staged, 'excluded', excluded);
END;
$$;

REVOKE ALL ON FUNCTION public.brreg_full_stage_batch(bigint, jsonb, jsonb, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brreg_full_stage_batch(bigint, jsonb, jsonb, bigint, bigint) TO service_role;