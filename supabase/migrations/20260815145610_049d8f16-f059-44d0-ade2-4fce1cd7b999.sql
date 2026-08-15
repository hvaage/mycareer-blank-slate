CREATE OR REPLACE FUNCTION public.brreg_full_apply_refined_filter(p_run_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'reg'
SET statement_timeout TO '120s'
AS $function$
DECLARE moved bigint := 0;
BEGIN
  -- Utvidet regel, utledet av fordelingsanalyse (august 2026):
  -- ansatte kreves for alle organisasjonsformer unntatt AS, ASA og offentlige.
  WITH d AS (
    DELETE FROM reg.brreg_full_staging s
     WHERE s.run_id = p_run_id
       AND coalesce(s.antall_ansatte, 0) <= 0
       AND coalesce(s.organisasjonsform_kode, '') NOT IN
           ('AS','ASA','STAT','KOMM','FYLK','KF','FKF','IKS','SF','ORGL','KIRK')
    RETURNING s.run_id, s.organisasjonsnummer
  ), i AS (
    INSERT INTO reg.brreg_full_excluded (run_id, organisasjonsnummer, reason)
    SELECT run_id, organisasjonsnummer, 'form_requires_employees' FROM d
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO moved FROM i;

  RETURN jsonb_build_object(
    'moved_to_excluded', moved,
    'staging_remaining', (SELECT count(*) FROM reg.brreg_full_staging WHERE run_id = p_run_id)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.brreg_full_apply_refined_filter(bigint) TO service_role;