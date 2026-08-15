DROP FUNCTION IF EXISTS public.brreg_full_merge(bigint, integer);

CREATE FUNCTION public.brreg_full_merge(p_run_id bigint, p_batch integer DEFAULT 25000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, reg
AS $fn$
DECLARE upserted bigint := 0; remaining bigint := 0; done boolean := false;
BEGIN
  WITH batch AS (
    SELECT * FROM reg.brreg_full_staging
     WHERE run_id = p_run_id AND merged_at IS NULL
     ORDER BY organisasjonsnummer
     LIMIT p_batch
  ), ins AS (
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
    FROM batch s
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
    RETURNING e.organisasjonsnummer
  ), mark AS (
    UPDATE reg.brreg_full_staging s
       SET merged_at = now()
      FROM ins
     WHERE s.run_id = p_run_id AND s.organisasjonsnummer = ins.organisasjonsnummer
    RETURNING 1
  )
  SELECT count(*) INTO upserted FROM mark;

  SELECT count(*) INTO remaining
    FROM reg.brreg_full_staging
   WHERE run_id = p_run_id AND merged_at IS NULL;

  done := remaining = 0;

  IF done THEN
    UPDATE reg.brreg_full_sync_runs
       SET rows_upserted = (SELECT count(*) FROM reg.brreg_full_staging WHERE run_id = p_run_id)
     WHERE id = p_run_id;
  END IF;

  -- Telleren for «manglet i fullfilen» settes IKKE her. Se
  -- public.brreg_full_apply_missing(), som kjøres som eget steg etter at
  -- alle porsjoner er bekreftet ferdige.
  RETURN jsonb_build_object('upserted', upserted, 'remaining', remaining, 'done', done, 'missing', 0);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.brreg_full_apply_missing(p_run_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, reg
AS $fn$
DECLARE remaining bigint; missing bigint := 0; applied timestamptz;
BEGIN
  SELECT count(*) INTO remaining
    FROM reg.brreg_full_staging
   WHERE run_id = p_run_id AND merged_at IS NULL;

  IF remaining > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'porsjoner gjenstår',
                              'remaining', remaining);
  END IF;

  SELECT (notes->>'missing_applied_at')::timestamptz INTO applied
    FROM reg.brreg_full_sync_runs WHERE id = p_run_id;

  IF applied IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_applied', true,
                              'applied_at', applied,
                              'missing', (SELECT rows_missing FROM reg.brreg_full_sync_runs WHERE id = p_run_id));
  END IF;

  WITH upd AS (
    UPDATE reg.enheter e
       SET brreg_full_missing_count = coalesce(e.brreg_full_missing_count, 0) + 1
     WHERE NOT EXISTS (
       SELECT 1 FROM reg.brreg_full_staging s
        WHERE s.run_id = p_run_id AND s.organisasjonsnummer = e.organisasjonsnummer)
    RETURNING 1
  ) SELECT count(*) INTO missing FROM upd;

  UPDATE reg.brreg_full_sync_runs
     SET rows_missing = missing,
         notes = notes || jsonb_build_object('missing_applied_at', now())
   WHERE id = p_run_id;

  RETURN jsonb_build_object('ok', true, 'already_applied', false, 'missing', missing);
END;
$fn$;

REVOKE ALL ON FUNCTION public.brreg_full_apply_missing(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brreg_full_apply_missing(bigint) TO service_role;