DO $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.cv_claim_attestations LIMIT 1;
  IF v_id IS NULL THEN RAISE EXCEPTION 'ingen attestasjon å teste mot'; END IF;

  BEGIN
    UPDATE public.cv_claim_attestations SET attested_claim_text = attested_claim_text || ' x' WHERE id = v_id;
    RAISE EXCEPTION 'FAIL_text_mutable';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'attestation_immutable' THEN RAISE EXCEPTION 'FAIL tekst: %', SQLERRM; END IF;
  END;

  BEGIN
    UPDATE public.cv_claim_attestations
       SET provenance = '{}'::jsonb, attested_by_user_id = gen_random_uuid(),
           attested_at = now(), attested_claim_version = 99,
           verification_at_attestation = 'supported', document_output_hash = 'x'
     WHERE id = v_id;
    RAISE EXCEPTION 'FAIL_provenance_mutable';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'attestation_immutable' THEN RAISE EXCEPTION 'FAIL provenance: %', SQLERRM; END IF;
  END;

  BEGIN
    UPDATE public.cv_claim_attestations
       SET external_source_name = 'Annen kilde', external_source_year = 1999, external_document_available = true
     WHERE id = v_id;
    RAISE EXCEPTION 'FAIL_source_mutable';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'attestation_immutable' THEN RAISE EXCEPTION 'FAIL kilde: %', SQLERRM; END IF;
  END;

  -- Tilbaketrekking skal være tillatt; rulles tilbake her.
  BEGIN
    UPDATE public.cv_claim_attestations SET withdrawn_at = now(), withdrawn_reason = 'test' WHERE id = v_id;
    RAISE EXCEPTION 'ROLLBACK_OK';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'ROLLBACK_OK' THEN RAISE EXCEPTION 'FAIL tilbaketrekking blokkert: %', SQLERRM; END IF;
  END;

  -- Ugyldiggjøring fra trigger skal være tillatt; rulles tilbake her.
  BEGIN
    UPDATE public.cv_claim_attestations SET invalidated_at = now(), invalidated_reason = 'claim_text_changed' WHERE id = v_id;
    RAISE EXCEPTION 'ROLLBACK_OK';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'ROLLBACK_OK' THEN RAISE EXCEPTION 'FAIL ugyldiggjøring blokkert: %', SQLERRM; END IF;
  END;

  RAISE NOTICE 'immutabilitetskontroller ok';
END $$;