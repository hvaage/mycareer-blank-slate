-- Fase 0: Permanent fjerning av jobbsignaler fra aktivt importløp
-- per produktkontrakt v1.1.

-- 1. Eksisterende jobbsignal-forslag settes superseded og tømmes for innhold.
--    Kun minimalt revisjonsspor beholdes.
UPDATE public.linkedin_reconciliation_proposals
   SET status = 'superseded',
       reason_codes = ARRAY['excluded_by_product_contract_v1_1'],
       source_snapshot_json = '{}'::jsonb,
       source_snapshot_hash = coalesce(source_snapshot_hash, ''),
       target_snapshot_json = '{}'::jsonb,
       target_snapshot_hash = coalesce(target_snapshot_hash, ''),
       proposed_payload_json = '{}'::jsonb,
       comparison_json = '{}'::jsonb,
       review_message = 'Jobbsignaler utelukkes av produktkontrakt v1.1.',
       superseded_at = now(),
       updated_at = now()
 WHERE proposal_domain = 'jobs'
   AND status = 'pending_review';

-- 2. Slett jobbsignal-stagingrader.
DELETE FROM public.linkedin_staging_records
 WHERE staging_domain = 'job'
    OR record_kind IN ('application','saved_job','online_job_posting','job_alert','job_seeker_preference');

-- 3. Legg til enum for staging-klassifisering dersom den ikke finnes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'linkedin_staging_classification') THEN
    CREATE TYPE public.linkedin_staging_classification AS ENUM (
      'A','B','excluded_by_product_contract_v1_1'
    );
  END IF;
END $$;

-- 4. Oppdater kolonnen til enum dersom den fortsatt er text.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='linkedin_staging_records'
      AND column_name='source_classification' AND data_type='text'
  ) THEN
    ALTER TABLE public.linkedin_staging_records
      ALTER COLUMN source_classification TYPE public.linkedin_staging_classification
      USING source_classification::public.linkedin_staging_classification;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;