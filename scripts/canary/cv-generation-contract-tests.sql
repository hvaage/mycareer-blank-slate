-- Kanarier for CV-genereringens backendkontrakt.
-- Kjøres mot databasen. Feiler høyt ved avvik.

-- 1. Nøyaktig én tillatt signatur for commit-steget.
DO $$
DECLARE n integer; sig text;
BEGIN
  SELECT count(*), min(p.oid::regprocedure::text) INTO n, sig
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'internal_ai_generation_commit_step';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Forventet nøyaktig én signatur for internal_ai_generation_commit_step, fant %', n;
  END IF;
  IF sig <> 'internal_ai_generation_commit_step(uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text,jsonb,uuid,text,text,boolean)' THEN
    RAISE EXCEPTION 'Uventet signatur: %', sig;
  END IF;
END $$;

-- 2. Evidensstatusene må være tillatt på påstander.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conrelid = 'public.cv_document_claims'::regclass
     AND conname = 'cv_document_claims_verification_check';
  IF def IS NULL OR def NOT LIKE '%user_attested%' OR def NOT LIKE '%contradicted%' THEN
    RAISE EXCEPTION 'Verifikasjonsstatusene mangler user_attested/contradicted: %', def;
  END IF;
END $$;

-- 3. Bekreftelser må være beskyttet av radnivåsikkerhet med egne policyer.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'cv_claim_attestations';
  IF n < 3 THEN
    RAISE EXCEPTION 'For få tilgangsregler på cv_claim_attestations: %', n;
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cv_claim_attestations'::regclass) THEN
    RAISE EXCEPTION 'RLS er ikke aktivert på cv_claim_attestations';
  END IF;
END $$;

-- 4. Kostnadsgrunnlaget må være komplett for avsluttede modellkjøringer.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM ai.model_runs
   WHERE finished_at IS NOT NULL AND input_tokens IS NOT NULL AND cost_complete IS NOT TRUE;
  IF n > 0 THEN
    RAISE EXCEPTION 'Modellkjøringer uten komplett kostnad: %', n;
  END IF;
END $$;

-- 5. Egen profil for omskriving.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ai.model_profiles
     WHERE task_key = 'cv_quality_rewrite' AND profile_key = 'cv_quality_rewrite_v1' AND is_active
  ) THEN
    RAISE EXCEPTION 'Mangler aktiv profil cv_quality_rewrite_v1 for oppgaven cv_quality_rewrite';
  END IF;
END $$;

SELECT 'cv-generation-contract-tests: OK' AS result;

-- 6. En bruker skal ikke kunne bekrefte en annen brukers påstand.
DO $$
DECLARE ok boolean;
BEGIN
  SELECT bool_and(
    with_check LIKE '%attested_by_user_id = auth.uid()%'
    AND with_check LIKE '%c.user_id = auth.uid()%')
    INTO ok
    FROM pg_policies
   WHERE tablename = 'cv_claim_attestations' AND cmd = 'INSERT';
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'Innsettingsregelen for bekreftelser er ikke bundet til den innloggede brukeren';
  END IF;
END $$;

-- 7. Alle aktive bekreftelser skal ha proveniens og versjon.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.cv_claim_attestations
   WHERE withdrawn_at IS NULL AND invalidated_at IS NULL
     AND (provenance = '{}'::jsonb OR attested_claim_version IS NULL);
  IF n > 0 THEN
    RAISE EXCEPTION 'Bekreftelser uten proveniens/versjon: %', n;
  END IF;
END $$;

-- Invariant: attestasjoner er immutable bortsett fra tilbaketrekking/ugyldiggjøring.
-- Kjøres i transaksjon; ingen rader endres.
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.cv_claim_attestations LIMIT 1;
  IF v_id IS NULL THEN RAISE NOTICE 'ingen attestasjoner – hopper over'; RETURN; END IF;

  BEGIN
    UPDATE public.cv_claim_attestations SET attested_claim_text = attested_claim_text || ' x' WHERE id = v_id;
    RAISE EXCEPTION 'FAIL: attested_claim_text kunne endres';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'attestation_immutable' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.cv_claim_attestations
       SET provenance = '{}'::jsonb, attested_by_user_id = gen_random_uuid(), attested_at = now(),
           attested_claim_version = 99, verification_at_attestation = 'supported',
           document_output_hash = 'x', external_source_name = 'Annen kilde',
           external_source_year = 1999, external_document_available = true
     WHERE id = v_id;
    RAISE EXCEPTION 'FAIL: proveniens/kilde kunne endres';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'attestation_immutable' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.cv_claim_attestations SET withdrawn_at = now(), withdrawn_reason = 'test' WHERE id = v_id;
    RAISE EXCEPTION 'ROLLBACK_OK';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'ROLLBACK_OK' THEN RAISE EXCEPTION 'FAIL: tilbaketrekking blokkert: %', SQLERRM; END IF;
  END;

  RAISE NOTICE 'attestasjon-immutabilitet ok';
END $$;
