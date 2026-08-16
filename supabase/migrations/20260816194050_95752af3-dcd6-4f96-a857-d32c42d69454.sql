ALTER TABLE public.cv_claim_attestations
  ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attested_claim_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS verification_at_attestation text,
  ADD COLUMN IF NOT EXISTS document_output_hash text;

COMMENT ON COLUMN public.cv_claim_attestations.provenance IS
  'Opprinnelse for bekreftelsen: kanal, aktør og hva brukeren fikk se. Aldri satt av modellen.';

-- Bekreftelsen skal alltid tilhøre den innloggede brukeren.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cv_claim_attestations'::regclass
       AND conname = 'cv_claim_attestations_actor_check'
  ) THEN
    ALTER TABLE public.cv_claim_attestations
      ADD CONSTRAINT cv_claim_attestations_actor_check
      CHECK (attested_by_user_id IS NOT NULL);
  END IF;
END $$;

-- Versjonsteller: hver ny bekreftelse på samme påstand teller opp.
CREATE OR REPLACE FUNCTION public.cv_claim_attestation_set_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT coalesce(max(a.attested_claim_version), 0) + 1
    INTO NEW.attested_claim_version
    FROM public.cv_claim_attestations a
   WHERE a.document_id = NEW.document_id AND a.claim_id = NEW.claim_id;

  IF NEW.verification_at_attestation IS NULL THEN
    SELECT c.verification INTO NEW.verification_at_attestation
      FROM public.cv_document_claims c
     WHERE c.document_id = NEW.document_id AND c.claim_id = NEW.claim_id;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cv_claim_attestation_version ON public.cv_claim_attestations;
CREATE TRIGGER cv_claim_attestation_version
  BEFORE INSERT ON public.cv_claim_attestations
  FOR EACH ROW EXECUTE FUNCTION public.cv_claim_attestation_set_version();