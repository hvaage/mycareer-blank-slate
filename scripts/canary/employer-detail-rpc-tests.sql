\set ON_ERROR_STOP on

-- Employer detail RPC contract. Run as migration/operator role.
-- All writes in this canary are temporary and rolled back.

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

CREATE TEMP TABLE employer_detail_rpc_fixture (
  orgnr text PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO employer_detail_rpc_fixture (orgnr)
SELECT e.organisasjonsnummer
FROM reg.enheter e
WHERE coalesce(e.slettet, false) = false
ORDER BY e.organisasjonsnummer
LIMIT 1;

DO $$
DECLARE
  v_orgnr text;
  v_count integer;
  v_row public.employer_search_v1%ROWTYPE;
BEGIN
  SELECT orgnr INTO v_orgnr FROM employer_detail_rpc_fixture LIMIT 1;

  PERFORM pg_temp.must('fixture organisation number exists', v_orgnr IS NOT NULL);
  PERFORM pg_temp.must(
    'get_employer_detail exists',
    to_regprocedure('public.get_employer_detail(text)') IS NOT NULL
  );
  PERFORM pg_temp.must(
    'get_employer_detail is SECURITY DEFINER',
    EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'get_employer_detail'
        AND p.proargtypes = '25'::oidvector
        AND p.prosecdef
        AND p.provolatile = 's'
    )
  );
  PERFORM pg_temp.must(
    'authenticated can execute detail RPC',
    has_function_privilege('authenticated', 'public.get_employer_detail(text)', 'EXECUTE')
  );
  PERFORM pg_temp.must(
    'service_role can execute detail RPC',
    has_function_privilege('service_role', 'public.get_employer_detail(text)', 'EXECUTE')
  );
  PERFORM pg_temp.must(
    'anon cannot execute detail RPC',
    NOT has_function_privilege('anon', 'public.get_employer_detail(text)', 'EXECUTE')
  );
  PERFORM pg_temp.must(
    'authenticated cannot select reg.enheter directly',
    NOT has_table_privilege('authenticated', 'reg.enheter', 'SELECT')
  );
  PERFORM pg_temp.must(
    'anon cannot select reg.enheter directly',
    NOT has_table_privilege('anon', 'reg.enheter', 'SELECT')
  );

  SELECT count(*)
  INTO v_count
  FROM public.get_employer_detail(v_orgnr);

  PERFORM pg_temp.must('operator detail RPC returns one row', v_count = 1);

  SELECT *
  INTO v_row
  FROM public.get_employer_detail(v_orgnr);

  PERFORM pg_temp.must('operator detail orgnr matches', v_row.organisasjonsnummer = v_orgnr);
  PERFORM pg_temp.must('operator detail name exists', nullif(v_row.navn, '') IS NOT NULL);

  SELECT count(*)
  INTO v_count
  FROM public.get_employer_detail('not an orgnr');

  PERFORM pg_temp.must('invalid orgnr returns no rows', v_count = 0);
END;
$$;

GRANT SELECT ON employer_detail_rpc_fixture TO authenticated, anon;

CREATE OR REPLACE FUNCTION pg_temp.assert_authenticated_contract()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_orgnr text;
  v_count integer;
  v_direct_denied boolean := false;
  v_view_denied boolean := false;
BEGIN
  SELECT orgnr INTO v_orgnr FROM pg_temp.employer_detail_rpc_fixture LIMIT 1;

  IF v_orgnr IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: authenticated fixture missing';
  END IF;

  BEGIN
    PERFORM 1 FROM reg.enheter LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN
    v_direct_denied := true;
  END;

  IF NOT v_direct_denied THEN
    RAISE EXCEPTION 'ASSERTION FAILED: authenticated unexpectedly reads reg.enheter';
  END IF;

  BEGIN
    PERFORM 1
    FROM public.employer_search_v1
    WHERE organisasjonsnummer = v_orgnr
    LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN
    v_view_denied := true;
  END;

  IF NOT v_view_denied THEN
    RAISE EXCEPTION 'ASSERTION FAILED: authenticated unexpectedly reads employer_search_v1 directly';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.get_employer_detail(v_orgnr);

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: authenticated detail RPC returned % rows', v_count;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_anon_contract()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_orgnr text;
  v_denied boolean := false;
BEGIN
  SELECT orgnr INTO v_orgnr FROM pg_temp.employer_detail_rpc_fixture LIMIT 1;

  IF v_orgnr IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: anon fixture missing';
  END IF;

  BEGIN
    PERFORM 1 FROM public.get_employer_detail(v_orgnr) LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION 'ASSERTION FAILED: anon unexpectedly executes get_employer_detail';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_authenticated_contract() TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.assert_anon_contract() TO anon;

SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_authenticated_contract();
RESET ROLE;

SET LOCAL ROLE anon;
SELECT pg_temp.assert_anon_contract();
RESET ROLE;

DO $$
BEGIN
  RAISE NOTICE 'Employer detail RPC tests PASS';
END;
$$;

ROLLBACK;
