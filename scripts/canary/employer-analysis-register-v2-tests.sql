-- Employer analysis v2 register contract tests.
-- Run as the migration/operator role. All writes are rolled back.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.must(p_label text, p_condition boolean)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(p_condition, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'ASSERTION FAILED: %', p_label;
  END IF;
END;
$$;

DO $$
DECLARE
  v_orgnr text;
  v_context jsonb;
  v_company_a uuid;
  v_company_b uuid;
  v_invalid_caught boolean := false;
BEGIN
  SELECT e.organisasjonsnummer
  INTO v_orgnr
  FROM reg.enheter e
  WHERE coalesce(e.slettet, false) = false
    AND EXISTS (
      SELECT 1
      FROM reg.regnskap r
      WHERE r.organisasjonsnummer = e.organisasjonsnummer
    )
  ORDER BY e.organisasjonsnummer
  LIMIT 1;

  PERFORM pg_temp.must('fixture organisation number exists', v_orgnr IS NOT NULL);

  v_context := public.get_employer_analysis_context(v_orgnr);
  PERFORM pg_temp.must('context exists', v_context IS NOT NULL);
  PERFORM pg_temp.must('context source is local mirror', v_context->>'source' = 'brreg_local_mirror');
  PERFORM pg_temp.must('context organisation number matches', v_context->>'organisasjonsnummer' = v_orgnr);
  PERFORM pg_temp.must('entity legal name exists', nullif(v_context#>>'{entity,legal_name}', '') IS NOT NULL);
  PERFORM pg_temp.must('financial history is array', jsonb_typeof(v_context->'financial_history') = 'array');
  PERFORM pg_temp.must('financial history capped at 3', jsonb_array_length(v_context->'financial_history') BETWEEN 1 AND 3);
  PERFORM pg_temp.must('raw register payload excluded', NOT (v_context::text LIKE '%raw_data%'));
  PERFORM pg_temp.must('contact fields excluded', NOT (v_context::text LIKE '%epostadresse%' OR v_context::text LIKE '%telefon%'));

  v_company_a := public.ensure_company_for_employer(v_orgnr);
  v_company_b := public.ensure_company_for_employer(v_orgnr);
  PERFORM pg_temp.must('ensure returns a company', v_company_a IS NOT NULL);
  PERFORM pg_temp.must('ensure is idempotent', v_company_a = v_company_b);
  PERFORM pg_temp.must(
    'company linked to organisation number',
    EXISTS (
      SELECT 1
      FROM public.companies c
      WHERE c.id = v_company_a
        AND c.organisasjonsnummer = v_orgnr
        AND c.brreg_match_source = 'brreg_orgnr'
        AND c.brreg_match_confidence = 1.0
    )
  );

  BEGIN
    PERFORM public.get_employer_analysis_context('invalid');
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_invalid_caught := true;
  END;
  PERFORM pg_temp.must('invalid organisation number rejected', v_invalid_caught);

  PERFORM pg_temp.must(
    'anon cannot read context RPC',
    NOT has_function_privilege('anon', 'public.get_employer_analysis_context(text)', 'EXECUTE')
  );
  PERFORM pg_temp.must(
    'authenticated cannot read context RPC',
    NOT has_function_privilege('authenticated', 'public.get_employer_analysis_context(text)', 'EXECUTE')
  );
  PERFORM pg_temp.must(
    'service role can read context RPC',
    has_function_privilege('service_role', 'public.get_employer_analysis_context(text)', 'EXECUTE')
  );
  PERFORM pg_temp.must(
    'anon cannot ensure company',
    NOT has_function_privilege('anon', 'public.ensure_company_for_employer(text)', 'EXECUTE')
  );
  PERFORM pg_temp.must(
    'authenticated cannot ensure company',
    NOT has_function_privilege('authenticated', 'public.ensure_company_for_employer(text)', 'EXECUTE')
  );
  PERFORM pg_temp.must(
    'service role can ensure company',
    has_function_privilege('service_role', 'public.ensure_company_for_employer(text)', 'EXECUTE')
  );

  RAISE NOTICE 'Employer analysis v2 register tests PASS for orgnr %', v_orgnr;
END;
$$;

ROLLBACK;
