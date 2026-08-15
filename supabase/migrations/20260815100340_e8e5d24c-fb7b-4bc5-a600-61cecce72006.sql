
CREATE INDEX IF NOT EXISTS brreg_full_staging_run_orgnr_idx
  ON reg.brreg_full_staging (run_id, organisasjonsnummer);
CREATE INDEX IF NOT EXISTS brreg_full_excluded_run_orgnr_idx
  ON reg.brreg_full_excluded (run_id, organisasjonsnummer);

-- Delport 1: radantall
CREATE OR REPLACE FUNCTION public.brreg_full_gate_counts(p_run_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, reg AS $$
  SELECT jsonb_build_object(
    'filtered_count', (SELECT count(*) FROM reg.brreg_full_staging WHERE run_id = p_run_id),
    'excluded_count', (SELECT count(*) FROM reg.brreg_full_excluded WHERE run_id = p_run_id),
    'mirror_count',   (SELECT count(*) FROM reg.enheter)
  );
$$;

-- Delport 2: overlapp og nye rader
CREATE OR REPLACE FUNCTION public.brreg_full_gate_overlap(p_run_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, reg AS $$
  WITH s AS (SELECT organisasjonsnummer FROM reg.brreg_full_staging WHERE run_id = p_run_id)
  SELECT jsonb_build_object(
    'overlap_count', (SELECT count(*) FROM s JOIN reg.enheter e USING (organisasjonsnummer)),
    'new_rows',      (SELECT count(*) FROM s WHERE NOT EXISTS (
                        SELECT 1 FROM reg.enheter e WHERE e.organisasjonsnummer = s.organisasjonsnummer)),
    'new_rows_samples', (SELECT coalesce(jsonb_agg(x.organisasjonsnummer), '[]'::jsonb) FROM (
                        SELECT organisasjonsnummer FROM s WHERE NOT EXISTS (
                          SELECT 1 FROM reg.enheter e WHERE e.organisasjonsnummer = s.organisasjonsnummer)
                        LIMIT 10) x)
  );
$$;

-- Delport 3: markøravvik innenfor overlappet
CREATE OR REPLACE FUNCTION public.brreg_full_gate_markers(p_run_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, reg AS $$
  WITH j AS (
    SELECT s.er_utdanning su, e.er_utdanning eu,
           s.er_rekruttering sr, e.er_rekruttering er,
           s.er_offentlig so, e.er_offentlig eo,
           s.er_i_konsern sk, e.er_i_konsern ek
    FROM reg.brreg_full_staging s
    JOIN reg.enheter e USING (organisasjonsnummer)
    WHERE s.run_id = p_run_id
  )
  SELECT jsonb_build_object(
    'er_utdanning',    (SELECT count(*) FROM j WHERE su IS DISTINCT FROM eu),
    'er_rekruttering', (SELECT count(*) FROM j WHERE sr IS DISTINCT FROM er),
    'er_offentlig',    (SELECT count(*) FROM j WHERE so IS DISTINCT FROM eo),
    'er_i_konsern',    (SELECT count(*) FROM j WHERE sk IS DISTINCT FROM ek)
  );
$$;

-- Delport 4: rader speilet har som filteret forkastet (viktigste beviset)
CREATE OR REPLACE FUNCTION public.brreg_full_gate_excluded_in_mirror(p_run_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, reg AS $$
  WITH x AS (
    SELECT x.organisasjonsnummer, x.reason
    FROM reg.brreg_full_excluded x
    JOIN reg.enheter e USING (organisasjonsnummer)
    WHERE x.run_id = p_run_id
  )
  SELECT jsonb_build_object(
    'excluded_present_in_mirror', (SELECT count(*) FROM x),
    'by_reason', (SELECT coalesce(jsonb_object_agg(reason, n), '{}'::jsonb)
                  FROM (SELECT reason, count(*) n FROM x GROUP BY 1) t),
    'samples', (SELECT coalesce(jsonb_agg(organisasjonsnummer), '[]'::jsonb)
                FROM (SELECT organisasjonsnummer FROM x LIMIT 10) t)
  );
$$;

-- Delport 5: rader speilet har som ikke finnes i kilden i det hele tatt
CREATE OR REPLACE FUNCTION public.brreg_full_gate_absent(p_run_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, reg AS $$
  WITH m AS (SELECT organisasjonsnummer FROM reg.enheter),
  absent AS (
    SELECT organisasjonsnummer FROM m
    WHERE NOT EXISTS (SELECT 1 FROM reg.brreg_full_staging s
                      WHERE s.run_id = p_run_id AND s.organisasjonsnummer = m.organisasjonsnummer)
      AND NOT EXISTS (SELECT 1 FROM reg.brreg_full_excluded x
                      WHERE x.run_id = p_run_id AND x.organisasjonsnummer = m.organisasjonsnummer)
  )
  SELECT jsonb_build_object(
    'absent_from_source', (SELECT count(*) FROM absent),
    'samples', (SELECT coalesce(jsonb_agg(organisasjonsnummer), '[]'::jsonb)
                FROM (SELECT organisasjonsnummer FROM absent LIMIT 10) t)
  );
$$;

-- Samlet port satt sammen av delene
CREATE OR REPLACE FUNCTION public.brreg_full_gate_metrics(p_run_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, reg AS $$
  WITH c AS (SELECT public.brreg_full_gate_counts(p_run_id) v),
       o AS (SELECT public.brreg_full_gate_overlap(p_run_id) v),
       mk AS (SELECT public.brreg_full_gate_markers(p_run_id) v),
       x AS (SELECT public.brreg_full_gate_excluded_in_mirror(p_run_id) v),
       a AS (SELECT public.brreg_full_gate_absent(p_run_id) v)
  SELECT (SELECT v FROM c) || (SELECT v FROM o)
       || jsonb_build_object('marker_diffs', (SELECT v FROM mk))
       || jsonb_build_object(
            'excluded_present_in_mirror', ((SELECT v FROM x) ->> 'excluded_present_in_mirror')::bigint,
            'absent_from_source', ((SELECT v FROM a) ->> 'absent_from_source')::bigint,
            'samples', jsonb_build_object(
              'excluded_present_in_mirror', (SELECT v FROM x) -> 'samples',
              'absent_from_source', (SELECT v FROM a) -> 'samples',
              'new_rows', (SELECT v FROM o) -> 'new_rows_samples'));
$$;

REVOKE ALL ON FUNCTION public.brreg_full_gate_counts(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brreg_full_gate_overlap(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brreg_full_gate_markers(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brreg_full_gate_excluded_in_mirror(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brreg_full_gate_absent(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brreg_full_gate_counts(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.brreg_full_gate_overlap(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.brreg_full_gate_markers(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.brreg_full_gate_excluded_in_mirror(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.brreg_full_gate_absent(bigint) TO service_role;
