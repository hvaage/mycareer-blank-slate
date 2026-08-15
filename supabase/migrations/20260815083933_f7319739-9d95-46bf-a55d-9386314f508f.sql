-- Fullnedlasting av enhetsspeilet: databaseside for fase 1-3.
-- reg.* er ikke eksponert i Data API, derfor SECURITY DEFINER-funksjoner i public
-- som bare service_role kan kalle.

CREATE OR REPLACE FUNCTION public.brreg_full_start_run(p_strict boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, reg
AS $$
DECLARE v jsonb;
BEGIN
  INSERT INTO reg.brreg_full_sync_runs (phase, status, strict_gate)
  VALUES ('phase1_download', 'running', p_strict)
  RETURNING to_jsonb(reg.brreg_full_sync_runs.*) INTO v;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.brreg_full_get_run(p_run_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, reg
AS $$
  SELECT to_jsonb(r.*) FROM reg.brreg_full_sync_runs r
  WHERE p_run_id IS NULL OR r.id = p_run_id
  ORDER BY r.id DESC LIMIT 1;
$$;

-- Oppdaterer tilstandsraden. Bare kjente nøkler tas imot; ukjente ignoreres.
CREATE OR REPLACE FUNCTION public.brreg_full_patch_run(p_run_id bigint, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, reg
AS $$
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
$$;

-- Mellomlagrer én batch fra fullfilen og flytter radmarkøren i samme transaksjon.
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
      SELECT * FROM jsonb_populate_recordset(NULL::reg.brreg_full_staging, p_rows)
    ), ins AS (
      INSERT INTO reg.brreg_full_staging
      SELECT p_run_id, (s).* FROM (SELECT s FROM src s) t(s)
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
         rows_excluded = r.rows_excluded + excluded,
         shard_count   = r.shard_count
   WHERE r.id = p_run_id;

  RETURN jsonb_build_object('staged', staged, 'excluded', excluded);
END;
$$;

CREATE OR REPLACE FUNCTION public.brreg_full_clear_staging(p_run_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, reg
AS $$
BEGIN
  DELETE FROM reg.brreg_full_staging WHERE run_id = p_run_id;
  DELETE FROM reg.brreg_full_excluded WHERE run_id = p_run_id;
  UPDATE reg.brreg_full_sync_runs
     SET rows_staged = 0, rows_excluded = 0, row_cursor = 0, rows_seen = 0, parse_complete = false
   WHERE id = p_run_id;
END;
$$;

-- Sammenligningsporten. Måler, skriver ingenting.
CREATE OR REPLACE FUNCTION public.brreg_full_gate_metrics(p_run_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, reg
AS $$
DECLARE v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'filtered_count', (SELECT count(*) FROM reg.brreg_full_staging s WHERE s.run_id = p_run_id),
    'mirror_count',   (SELECT count(*) FROM reg.enheter),
    'overlap_count',  (SELECT count(*) FROM reg.enheter e
                        JOIN reg.brreg_full_staging s
                          ON s.run_id = p_run_id AND s.organisasjonsnummer = e.organisasjonsnummer),
    'excluded_count', (SELECT count(*) FROM reg.brreg_full_excluded x WHERE x.run_id = p_run_id),
    'excluded_present_in_mirror', (SELECT count(*) FROM reg.enheter e
                        JOIN reg.brreg_full_excluded x
                          ON x.run_id = p_run_id AND x.organisasjonsnummer = e.organisasjonsnummer),
    'absent_from_source', (SELECT count(*) FROM reg.enheter e
                        WHERE NOT EXISTS (SELECT 1 FROM reg.brreg_full_staging s
                                           WHERE s.run_id = p_run_id AND s.organisasjonsnummer = e.organisasjonsnummer)
                          AND NOT EXISTS (SELECT 1 FROM reg.brreg_full_excluded x
                                           WHERE x.run_id = p_run_id AND x.organisasjonsnummer = e.organisasjonsnummer)),
    'new_rows', (SELECT count(*) FROM reg.brreg_full_staging s
                  WHERE s.run_id = p_run_id
                    AND NOT EXISTS (SELECT 1 FROM reg.enheter e WHERE e.organisasjonsnummer = s.organisasjonsnummer)),
    'marker_diffs', (SELECT jsonb_build_object(
        'er_utdanning',    count(*) FILTER (WHERE coalesce(e.er_utdanning,false)    IS DISTINCT FROM coalesce(s.er_utdanning,false)),
        'er_rekruttering', count(*) FILTER (WHERE coalesce(e.er_rekruttering,false) IS DISTINCT FROM coalesce(s.er_rekruttering,false)),
        'er_offentlig',    count(*) FILTER (WHERE coalesce(e.er_offentlig,false)    IS DISTINCT FROM coalesce(s.er_offentlig,false)),
        'er_i_konsern',    count(*) FILTER (WHERE coalesce(e.er_i_konsern,false)    IS DISTINCT FROM coalesce(s.er_i_konsern,false)))
      FROM reg.enheter e
      JOIN reg.brreg_full_staging s ON s.run_id = p_run_id AND s.organisasjonsnummer = e.organisasjonsnummer),
    'samples', jsonb_build_object(
      'excluded_present_in_mirror', (SELECT coalesce(jsonb_agg(t.organisasjonsnummer), '[]'::jsonb) FROM (
          SELECT e.organisasjonsnummer FROM reg.enheter e
          JOIN reg.brreg_full_excluded x ON x.run_id = p_run_id AND x.organisasjonsnummer = e.organisasjonsnummer
          LIMIT 50) t),
      'absent_from_source', (SELECT coalesce(jsonb_agg(t.organisasjonsnummer), '[]'::jsonb) FROM (
          SELECT e.organisasjonsnummer FROM reg.enheter e
          WHERE NOT EXISTS (SELECT 1 FROM reg.brreg_full_staging s WHERE s.run_id = p_run_id AND s.organisasjonsnummer = e.organisasjonsnummer)
            AND NOT EXISTS (SELECT 1 FROM reg.brreg_full_excluded x WHERE x.run_id = p_run_id AND x.organisasjonsnummer = e.organisasjonsnummer)
          LIMIT 50) t),
      'marker_mismatch', (SELECT coalesce(jsonb_agg(t.organisasjonsnummer), '[]'::jsonb) FROM (
          SELECT e.organisasjonsnummer FROM reg.enheter e
          JOIN reg.brreg_full_staging s ON s.run_id = p_run_id AND s.organisasjonsnummer = e.organisasjonsnummer
          WHERE coalesce(e.er_utdanning,false)    IS DISTINCT FROM coalesce(s.er_utdanning,false)
             OR coalesce(e.er_rekruttering,false) IS DISTINCT FROM coalesce(s.er_rekruttering,false)
             OR coalesce(e.er_offentlig,false)    IS DISTINCT FROM coalesce(s.er_offentlig,false)
             OR coalesce(e.er_i_konsern,false)    IS DISTINCT FROM coalesce(s.er_i_konsern,false)
          LIMIT 50) t)
    )
  ) INTO v;
  RETURN v;
END;
$$;

-- Fase 3-skriving. Upsert-only. Ingen rad slettes noen gang fra reg.enheter.
CREATE OR REPLACE FUNCTION public.brreg_full_merge(p_run_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, reg
AS $$
DECLARE upserted bigint := 0; missing bigint := 0;
BEGIN
  WITH ins AS (
    INSERT INTO reg.enheter AS e (
      organisasjonsnummer, navn, organisasjonsform_kode, organisasjonsform_beskrivelse,
      naeringskode1_kode, naeringskode1_beskrivelse, naeringskode2_kode, naeringskode2_beskrivelse,
      naeringskode3_kode, naeringskode3_beskrivelse, antall_ansatte, har_registrert_antall_ansatte,
      forretningsadresse_poststed, forretningsadresse_postnummer, forretningsadresse_kommune,
      forretningsadresse_kommunenummer, postadresse_poststed, postadresse_postnummer,
      postadresse_kommune, postadresse_kommunenummer, institusjonell_sektorkode,
      stiftelsesdato, registreringsdato_enhetsregisteret, konkurs, konkursdato,
      under_avvikling, under_avvikling_dato, under_tvangsavvikling_eller_tvangsopplosning,
      slettet, registrert_i_foretaksregisteret, registrert_i_mvaregisteret,
      registrert_i_frivillighetsregisteret, registrert_i_stiftelsesregisteret,
      registrert_i_partiregisteret, hjemmeside, epostadresse, telefon, mobil,
      maalform, aktivitet, vedtektsdato, vedtektsfestet_formaal,
      siste_innsendte_aarsregnskap, overordnet_enhet,
      er_utdanning, er_rekruttering, er_offentlig, er_i_konsern,
      hentet_tidspunkt, last_seen_in_brreg_full, brreg_full_missing_count
    )
    SELECT
      s.organisasjonsnummer, s.navn, s.organisasjonsform_kode, s.organisasjonsform_beskrivelse,
      s.naeringskode1_kode, s.naeringskode1_beskrivelse, s.naeringskode2_kode, s.naeringskode2_beskrivelse,
      s.naeringskode3_kode, s.naeringskode3_beskrivelse, s.antall_ansatte, s.har_registrert_antall_ansatte,
      s.forretningsadresse_poststed, s.forretningsadresse_postnummer, s.forretningsadresse_kommune,
      s.forretningsadresse_kommunenummer, s.postadresse_poststed, s.postadresse_postnummer,
      s.postadresse_kommune, s.postadresse_kommunenummer, s.institusjonell_sektorkode,
      s.stiftelsesdato, s.registreringsdato_enhetsregisteret, s.konkurs, s.konkursdato,
      s.under_avvikling, s.under_avvikling_dato, s.under_tvangsavvikling_eller_tvangsopplosning,
      s.slettet, s.registrert_i_foretaksregisteret, s.registrert_i_mvaregisteret,
      s.registrert_i_frivillighetsregisteret, s.registrert_i_stiftelsesregisteret,
      s.registrert_i_partiregisteret, s.hjemmeside, s.epostadresse, s.telefon, s.mobil,
      s.maalform, s.aktivitet, s.vedtektsdato, s.vedtektsfestet_formaal,
      s.siste_innsendte_aarsregnskap, s.overordnet_enhet,
      s.er_utdanning, s.er_rekruttering, s.er_offentlig, s.er_i_konsern,
      now(), current_date, 0
    FROM reg.brreg_full_staging s
    WHERE s.run_id = p_run_id
    ON CONFLICT (organisasjonsnummer) DO UPDATE SET
      navn = EXCLUDED.navn,
      organisasjonsform_kode = EXCLUDED.organisasjonsform_kode,
      organisasjonsform_beskrivelse = EXCLUDED.organisasjonsform_beskrivelse,
      naeringskode1_kode = EXCLUDED.naeringskode1_kode,
      naeringskode1_beskrivelse = EXCLUDED.naeringskode1_beskrivelse,
      naeringskode2_kode = EXCLUDED.naeringskode2_kode,
      naeringskode2_beskrivelse = EXCLUDED.naeringskode2_beskrivelse,
      naeringskode3_kode = EXCLUDED.naeringskode3_kode,
      naeringskode3_beskrivelse = EXCLUDED.naeringskode3_beskrivelse,
      antall_ansatte = EXCLUDED.antall_ansatte,
      har_registrert_antall_ansatte = EXCLUDED.har_registrert_antall_ansatte,
      forretningsadresse_poststed = EXCLUDED.forretningsadresse_poststed,
      forretningsadresse_postnummer = EXCLUDED.forretningsadresse_postnummer,
      forretningsadresse_kommune = EXCLUDED.forretningsadresse_kommune,
      forretningsadresse_kommunenummer = EXCLUDED.forretningsadresse_kommunenummer,
      postadresse_poststed = EXCLUDED.postadresse_poststed,
      postadresse_postnummer = EXCLUDED.postadresse_postnummer,
      postadresse_kommune = EXCLUDED.postadresse_kommune,
      postadresse_kommunenummer = EXCLUDED.postadresse_kommunenummer,
      institusjonell_sektorkode = EXCLUDED.institusjonell_sektorkode,
      stiftelsesdato = EXCLUDED.stiftelsesdato,
      registreringsdato_enhetsregisteret = EXCLUDED.registreringsdato_enhetsregisteret,
      konkurs = EXCLUDED.konkurs,
      konkursdato = EXCLUDED.konkursdato,
      under_avvikling = EXCLUDED.under_avvikling,
      under_avvikling_dato = EXCLUDED.under_avvikling_dato,
      under_tvangsavvikling_eller_tvangsopplosning = EXCLUDED.under_tvangsavvikling_eller_tvangsopplosning,
      slettet = EXCLUDED.slettet,
      registrert_i_foretaksregisteret = EXCLUDED.registrert_i_foretaksregisteret,
      registrert_i_mvaregisteret = EXCLUDED.registrert_i_mvaregisteret,
      registrert_i_frivillighetsregisteret = EXCLUDED.registrert_i_frivillighetsregisteret,
      registrert_i_stiftelsesregisteret = EXCLUDED.registrert_i_stiftelsesregisteret,
      registrert_i_partiregisteret = EXCLUDED.registrert_i_partiregisteret,
      hjemmeside = EXCLUDED.hjemmeside,
      epostadresse = EXCLUDED.epostadresse,
      telefon = EXCLUDED.telefon,
      mobil = EXCLUDED.mobil,
      maalform = EXCLUDED.maalform,
      aktivitet = EXCLUDED.aktivitet,
      vedtektsdato = EXCLUDED.vedtektsdato,
      vedtektsfestet_formaal = EXCLUDED.vedtektsfestet_formaal,
      siste_innsendte_aarsregnskap = EXCLUDED.siste_innsendte_aarsregnskap,
      overordnet_enhet = EXCLUDED.overordnet_enhet,
      er_utdanning = EXCLUDED.er_utdanning,
      er_rekruttering = EXCLUDED.er_rekruttering,
      er_offentlig = EXCLUDED.er_offentlig,
      er_i_konsern = EXCLUDED.er_i_konsern,
      hentet_tidspunkt = now(),
      last_seen_in_brreg_full = current_date,
      brreg_full_missing_count = 0
    RETURNING 1
  ) SELECT count(*) INTO upserted FROM ins;

  WITH upd AS (
    UPDATE reg.enheter e
       SET brreg_full_missing_count = coalesce(e.brreg_full_missing_count, 0) + 1
     WHERE NOT EXISTS (SELECT 1 FROM reg.brreg_full_staging s
                        WHERE s.run_id = p_run_id AND s.organisasjonsnummer = e.organisasjonsnummer)
    RETURNING 1
  ) SELECT count(*) INTO missing FROM upd;

  UPDATE reg.brreg_full_sync_runs
     SET rows_upserted = upserted, rows_missing = missing
   WHERE id = p_run_id;

  RETURN jsonb_build_object('upserted', upserted, 'missing', missing);
END;
$$;

REVOKE ALL ON FUNCTION public.brreg_full_start_run(boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brreg_full_get_run(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brreg_full_patch_run(bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brreg_full_stage_batch(bigint, jsonb, jsonb, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brreg_full_clear_staging(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brreg_full_gate_metrics(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brreg_full_merge(bigint) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.brreg_full_start_run(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.brreg_full_get_run(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.brreg_full_patch_run(bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.brreg_full_stage_batch(bigint, jsonb, jsonb, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.brreg_full_clear_staging(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.brreg_full_gate_metrics(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.brreg_full_merge(bigint) TO service_role;