DO $$
DECLARE d text; anchor text; repl text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO d
  FROM pg_proc WHERE proname = 'network_company_reconciliation_scan' LIMIT 1;

  anchor := E'    IF FOUND THEN\n      INSERT INTO public.network_company_reconciliation (';
  repl := E'    IF NOT FOUND AND v_obs.source_system = ''user_opportunity'' THEN\n'
       || E'      SELECT g.* INTO v_global\n'
       || E'      FROM public.source_company_resolutions g\n'
       || E'      JOIN public.user_opportunities uo ON uo.id = v_obs.source_record_id::uuid\n'
       || E'      WHERE g.superseded_at IS NULL\n'
       || E'        AND g.source_system = ''canonical_opportunity''\n'
       || E'        AND uo.canonical_opportunity_id IS NOT NULL\n'
       || E'        AND g.source_record_id = uo.canonical_opportunity_id::text\n'
       || E'      LIMIT 1;\n'
       || E'    END IF;\n\n'
       || anchor;

  IF position(anchor in d) = 0 THEN
    RAISE EXCEPTION 'Fant ikke ankeret i funksjonsdefinisjonen';
  END IF;

  d := replace(d, anchor, repl);
  EXECUTE d;
END $$;