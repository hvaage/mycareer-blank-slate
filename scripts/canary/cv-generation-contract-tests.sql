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
