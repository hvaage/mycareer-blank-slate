DROP TABLE IF EXISTS public._sec5a_results;
CREATE TABLE public._sec5a_results(seq int, step text, result text, detail text);
REVOKE ALL ON public._sec5a_results FROM anon, authenticated;

DO $outer$
DECLARE
  v_a uuid := '8103b452-0a27-46b0-a204-e2d9db34ec22';
  v_b uuid := '3b5e8b1c-e3bb-43d2-a96f-0b40cf21b874';
  v_company uuid := 'ae0b667f-1e25-4782-8a74-baed8a8fcb91';
  v_batch uuid := '253f0538-6f24-48cd-8b88-6cc5e8e95e10';
  v_items uuid[] := ARRAY['0012973a-a060-423e-9cba-8a0e2dc70b97','001335d6-7023-43a0-a325-913ade80f9e6','001aee92-77c6-45e6-95da-ea24435bc4d0']::uuid[];
  r jsonb;
  t1 text := 'FAIL'; t1d text := '';
  t2 text := 'FAIL'; t2d text := '';
  t3 text := 'FAIL'; t3d text := '';
  t5 text := 'FAIL'; t5d text := '';
  v_a_status text; v_a_prio text; v_b_status text; v_b_prio text;
  v_a_rows int; v_b_rows int;
  v_c int; v_i int; v_rel int; v_pending int; v_err text := '';
BEGIN
  BEGIN
    ---------------------------------------------------------------
    -- T1: bruker A setter status/prioritet på egen relasjon
    ---------------------------------------------------------------
    SELECT public.network_set_company_relationship(v_a, v_company, 'target', 'high', 'Equinor ASA') INTO r;
    SELECT count(*) INTO v_a_rows FROM public.user_company_relationships WHERE user_id = v_a AND company_id = v_company;
    SELECT status, priority INTO v_a_status, v_a_prio FROM public.user_company_relationships WHERE user_id = v_a AND company_id = v_company;
    IF coalesce((r->>'ok')::boolean,false) AND v_a_rows = 1 AND v_a_status = 'target' AND v_a_prio = 'high' THEN
      t1 := 'PASS';
    END IF;
    t1d := format('rpc=%s rows_A=%s status=%s priority=%s', r::text, v_a_rows, v_a_status, v_a_prio);

    ---------------------------------------------------------------
    -- T2: bruker B forsøker samme selskap; A sin rad skal ikke endres
    ---------------------------------------------------------------
    SELECT public.network_set_company_relationship(v_b, v_company, 'paused', 'low', 'Equinor ASA') INTO r;
    SELECT status, priority INTO v_a_status, v_a_prio FROM public.user_company_relationships WHERE user_id = v_a AND company_id = v_company;
    SELECT count(*) INTO v_b_rows FROM public.user_company_relationships WHERE user_id = v_b AND company_id = v_company;
    SELECT status, priority INTO v_b_status, v_b_prio FROM public.user_company_relationships WHERE user_id = v_b AND company_id = v_company;
    IF v_a_status = 'target' AND v_a_prio = 'high' AND v_b_rows = 1 AND v_b_status = 'paused' THEN
      t2 := 'PASS';
    END IF;
    t2d := format('A_after=%s/%s  B_own_rows=%s B=%s/%s', v_a_status, v_a_prio, v_b_rows, v_b_status, v_b_prio);

    ---------------------------------------------------------------
    -- T3: bruker B forsøker å promotere A sin ready-batch
    ---------------------------------------------------------------
    SELECT public.network_promote_batch_person_contacts(v_b, v_batch, v_items) INTO r;
    SELECT count(*) INTO v_c FROM public.network_contacts;
    SELECT count(*) INTO v_pending FROM public.linkedin_network_reconciliation_batch_items
      WHERE id = ANY(v_items) AND status = 'pending';
    IF coalesce((r->>'ok')::boolean,true) = false AND (r->>'error_code') = 'batch_not_found'
       AND v_c = 0 AND v_pending = 3 THEN
      t3 := 'PASS';
    END IF;
    t3d := format('rpc=%s contacts=%s items_still_pending=%s', r::text, v_c, v_pending);

    ---------------------------------------------------------------
    -- T5: framprovosert feil midt i batchen -> alt skal rulles tilbake
    ---------------------------------------------------------------
    CREATE TABLE public._sec5a_counter(n int);
    INSERT INTO public._sec5a_counter VALUES (0);
    CREATE FUNCTION public._sec5a_fail() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      UPDATE public._sec5a_counter SET n = n + 1;
      IF (SELECT n FROM public._sec5a_counter) >= 2 THEN
        RAISE EXCEPTION 'SYNTHETIC_FAILURE_MIDBATCH';
      END IF;
      RETURN NEW;
    END;
    $fn$;
    CREATE TRIGGER _sec5a_fail_trg BEFORE INSERT ON public.network_contacts
      FOR EACH ROW EXECUTE FUNCTION public._sec5a_fail();

    BEGIN
      SELECT public.network_promote_batch_person_contacts(v_a, v_batch, v_items) INTO r;
      v_err := 'no_exception_raised';
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
    END;

    SELECT count(*) INTO v_c FROM public.network_contacts;
    SELECT count(*) INTO v_i FROM public.network_contact_identities;
    SELECT count(*) INTO v_rel FROM public.network_contact_company_relations;
    SELECT count(*) INTO v_pending FROM public.linkedin_network_reconciliation_batch_items
      WHERE id = ANY(v_items) AND status = 'pending';
    IF v_err LIKE '%SYNTHETIC_FAILURE_MIDBATCH%' AND v_c = 0 AND v_i = 0 AND v_rel = 0 AND v_pending = 3 THEN
      t5 := 'PASS';
    END IF;
    t5d := format('error=%s contacts=%s identities=%s relations=%s items_still_pending=%s',
                  v_err, v_c, v_i, v_rel, v_pending);

    RAISE EXCEPTION 'SEC5A_ROLLBACK_SENTINEL';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SEC5A_ROLLBACK_SENTINEL' THEN
      t5d := t5d || ' | uventet feil: ' || SQLERRM;
    END IF;
  END;

  INSERT INTO public._sec5a_results(seq, step, result, detail) VALUES
    (1, 'T1 A setter status/prioritet paa egen relasjon', t1, t1d),
    (2, 'T2 B kan ikke endre A sin relasjon', t2, t2d),
    (3, 'T3 A/B kan ikke promotere annen brukers ready-batch', t3, t3d),
    (5, 'T5 feil midt i promotering ruller tilbake alt', t5, t5d);
END;
$outer$;