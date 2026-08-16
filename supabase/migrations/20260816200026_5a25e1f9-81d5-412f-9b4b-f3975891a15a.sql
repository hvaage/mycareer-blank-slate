CREATE OR REPLACE FUNCTION public.cv_claim_attestation_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.document_id IS DISTINCT FROM OLD.document_id
       OR NEW.claim_id IS DISTINCT FROM OLD.claim_id
       OR NEW.attested_by_user_id IS DISTINCT FROM OLD.attested_by_user_id
       OR NEW.attested_at IS DISTINCT FROM OLD.attested_at
       OR NEW.attested_claim_text IS DISTINCT FROM OLD.attested_claim_text
       OR NEW.attested_claim_hash IS DISTINCT FROM OLD.attested_claim_hash
       OR NEW.attested_claim_version IS DISTINCT FROM OLD.attested_claim_version
       OR NEW.verification_at_attestation IS DISTINCT FROM OLD.verification_at_attestation
       OR NEW.document_output_hash IS DISTINCT FROM OLD.document_output_hash
       OR NEW.provenance IS DISTINCT FROM OLD.provenance
       OR NEW.note IS DISTINCT FROM OLD.note
       OR NEW.external_source_name IS DISTINCT FROM OLD.external_source_name
       OR NEW.external_source_year IS DISTINCT FROM OLD.external_source_year
       OR NEW.external_document_available IS DISTINCT FROM OLD.external_document_available
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'attestation_immutable'
        USING HINT = 'En bekreftelse kan bare trekkes tilbake, ikke endres.';
    END IF;

    IF OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at THEN
      RAISE EXCEPTION 'attestation_withdrawal_immutable';
    END IF;
    IF OLD.invalidated_at IS NOT NULL AND NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at THEN
      RAISE EXCEPTION 'attestation_invalidation_immutable';
    END IF;

    NEW.attested_claim_hash := OLD.attested_claim_hash;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  NEW.attested_claim_hash := md5(btrim(NEW.attested_claim_text));
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;