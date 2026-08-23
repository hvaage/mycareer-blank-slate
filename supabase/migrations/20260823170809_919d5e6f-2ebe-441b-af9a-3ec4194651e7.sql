ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS employer_analysis_output_validation_status text NOT NULL DEFAULT 'unvalidated',
  ADD COLUMN IF NOT EXISTS employer_analysis_output_validated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'companies_analysis_output_validation_status_check'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_analysis_output_validation_status_check
      CHECK (employer_analysis_output_validation_status IN ('unvalidated','valid','invalid'));
  END IF;
END $$;

-- Deterministisk serverside-validering av analyseoutput.
CREATE OR REPLACE FUNCTION public.employer_analysis_output_is_valid(
  p_orgnr text,
  p_analysis jsonb,
  p_version integer,
  p_rated_at timestamptz
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    p_orgnr IS NOT NULL
    AND p_orgnr ~ '^[0-9]{9}$'
    AND p_analysis IS NOT NULL
    AND jsonb_typeof(p_analysis->'dimensions') = 'array'
    AND p_version IS NOT NULL
    AND p_rated_at IS NOT NULL
    AND (
      SELECT count(*) FROM jsonb_array_elements(p_analysis->'dimensions') d
      WHERE jsonb_typeof(d->'score') = 'number'
    ) > 0
$$;

CREATE OR REPLACE FUNCTION public._companies_validate_analysis_output()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.employer_analysis_v2 IS NULL THEN
    NEW.employer_analysis_output_validation_status := 'unvalidated';
    NEW.employer_analysis_output_validated_at := NULL;
    RETURN NEW;
  END IF;

  IF public.employer_analysis_output_is_valid(
       NEW.organisasjonsnummer,
       NEW.employer_analysis_v2,
       NEW.employer_analysis_version,
       NEW.employer_analysis_rated_at) THEN
    NEW.employer_analysis_output_validation_status := 'valid';
  ELSE
    NEW.employer_analysis_output_validation_status := 'invalid';
  END IF;
  NEW.employer_analysis_output_validated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS companies_validate_analysis_output ON public.companies;
CREATE TRIGGER companies_validate_analysis_output
  BEFORE INSERT OR UPDATE OF employer_analysis_v2, employer_analysis_version, employer_analysis_rated_at, organisasjonsnummer
  ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public._companies_validate_analysis_output();