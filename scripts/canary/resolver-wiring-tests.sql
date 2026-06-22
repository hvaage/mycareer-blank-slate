-- Rev. 5 §6: end-to-end rollback tests through careerjet_resolve_listing.
-- All work is wrapped in a transaction with a final ROLLBACK; no DELETE cleanup.
-- The tests assert scoped before/after deltas, never absolute counts.

BEGIN;

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION pg_temp.must(p_label text, p_cond boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_cond THEN RAISE EXCEPTION 'ASSERT FAILED: %', p_label; END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.must_eq(p_label text, a anyelement, b anyelement) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF a IS DISTINCT FROM b THEN
    RAISE EXCEPTION 'ASSERT FAILED: % (got=% expected=%)', p_label, a, b;
  END IF;
END $$;

DO $body$
DECLARE
  v_run_id              uuid := gen_random_uuid();
  v_fp                  text := encode(extensions.digest('rev5-test-'||v_run_id::text,'sha256'),'hex');
  v_fp_version          smallint := 1;
  v_token               bigint;
  v_post_in             jsonb;
  v_post_in_changed     jsonb;
  v_post_in_noop        jsonb;
  v_resp                jsonb;
  v_canon               jsonb;
  v_thread_id           uuid;
  v_keeper_id           uuid;
  v_canonical_id        uuid;
  v_canon_updated_a     timestamptz;
  v_canon_updated_b     timestamptz;

  -- scoped deltas
  v_th0 int; v_th1 int; v_th2 int; v_th3 int;
  v_sp0 int; v_sp1 int; v_sp2 int; v_sp3 int;
  v_obs0 int; v_obs1 int; v_obs2 int; v_obs3 int;
  v_co0 int; v_co1 int; v_co2 int; v_co3 int;
  v_lnk0 int; v_lnk1 int; v_lnk2 int; v_lnk3 int;
  v_aud0 int; v_aud1 int; v_aud2 int; v_aud3 int;
  v_aud_canon0 int; v_aud_canon3 int;

  -- T4 (review)
  v_t4_aud_before int; v_t4_aud_after int;
  v_t4_co_before  int; v_t4_co_after  int;
  v_t4_lnk_before int; v_t4_lnk_after int;
  v_t4_resp jsonb;

  -- T5 (invariant)
  v_t5_fp text;
  v_t5_thread_id uuid := gen_random_uuid();
  v_t5_keeper_id uuid := gen_random_uuid();
  v_t5_th_before int; v_t5_th_after int;
  v_t5_sp_before int; v_t5_sp_after int;
  v_t5_obs_before int; v_t5_obs_after int;
  v_t5_co_before int; v_t5_co_after int;
  v_t5_lnk_before int; v_t5_lnk_after int;
  v_t5_aud_before int; v_t5_aud_after int;
  v_t5_caught text := NULL;
BEGIN
  -- Create synthetic sync_run (mode=resolver_wiring_test) and claim the lease.
  INSERT INTO public.careerjet_sync_runs (id, status, meta)
  VALUES (v_run_id, 'running', jsonb_build_object('mode','resolver_wiring_test'));

  SELECT fencing_token INTO v_token
    FROM public.careerjet_lease_claim('careerjet_global', v_run_id, 600);
  PERFORM pg_temp.must('lease_claimed', v_token IS NOT NULL AND v_token > 0);

  v_post_in := jsonb_build_object(
    'raw_url','https://example.test/rev5/a',
    'display_url','https://example.test/rev5/a',
    'raw_url_hash', encode(extensions.digest('rev5-a','sha256'),'hex'),
    'title','Rev5 Senior Engineer',
    'company','Rev5 Synthetic AS',
    'location','Oslo',
    'description','Rev5 synthetic listing for resolver-wiring test.',
    'site','example.test',
    'employment', '{}'::jsonb,
    'published_at', now()::text
  );

  -- ===== T1: first_sight =====
  SELECT count(*) INTO v_th0 FROM public.careerjet_source_threads WHERE identity_fingerprint = v_fp;
  SELECT count(*) INTO v_sp0 FROM public.source_postings WHERE identity_fingerprint = v_fp;
  SELECT count(*) INTO v_obs0 FROM public.careerjet_source_observations WHERE sync_run_id = v_run_id;
  SELECT count(*) INTO v_co0 FROM public.canonical_opportunities WHERE identity_fingerprint = v_fp;
  SELECT count(*) INTO v_lnk0 FROM public.opportunity_source_links osl
    JOIN public.canonical_opportunities co ON co.id = osl.canonical_opportunity_id
    WHERE co.identity_fingerprint = v_fp;
  SELECT count(*) INTO v_aud0 FROM public.careerjet_identity_audit WHERE run_id = v_run_id;
  SELECT count(*) INTO v_aud_canon0 FROM public.careerjet_identity_audit
    WHERE run_id = v_run_id AND action = 'canonicalize';

  v_resp := public.careerjet_resolve_listing(
    v_run_id, v_token, v_fp_version, v_fp, v_post_in,
    '[]'::jsonb, '[]'::jsonb);

  PERFORM pg_temp.must_eq('T1.action=first_sight', v_resp->>'action', 'first_sight');
  v_canon := v_resp->'canonicalization';
  PERFORM pg_temp.must('T1.canonicalization present', v_canon IS NOT NULL);
  PERFORM pg_temp.must_eq('T1.canonical_created', (v_canon->>'canonical_created')::boolean, true);
  PERFORM pg_temp.must_eq('T1.keeper_link_created', (v_canon->>'keeper_link_created')::boolean, true);
  PERFORM pg_temp.must_eq('T1.link_role=primary', v_canon->>'link_role', 'primary');
  PERFORM pg_temp.must_eq('T1.fencing_token_valid', (v_canon->>'fencing_token_valid')::boolean, true);

  v_thread_id    := (v_resp->>'thread_id')::uuid;
  v_keeper_id    := (v_resp->>'keeper_source_posting_id')::uuid;
  v_canonical_id := (v_canon->>'canonical_id')::uuid;

  SELECT count(*) INTO v_th1 FROM public.careerjet_source_threads WHERE identity_fingerprint = v_fp;
  SELECT count(*) INTO v_sp1 FROM public.source_postings WHERE identity_fingerprint = v_fp;
  SELECT count(*) INTO v_obs1 FROM public.careerjet_source_observations WHERE sync_run_id = v_run_id;
  SELECT count(*) INTO v_co1 FROM public.canonical_opportunities WHERE identity_fingerprint = v_fp;
  SELECT count(*) INTO v_lnk1 FROM public.opportunity_source_links osl
    JOIN public.canonical_opportunities co ON co.id = osl.canonical_opportunity_id
    WHERE co.identity_fingerprint = v_fp;

  PERFORM pg_temp.must_eq('T1 thread delta=1', v_th1 - v_th0, 1);
  PERFORM pg_temp.must_eq('T1 source_posting delta=1', v_sp1 - v_sp0, 1);
  PERFORM pg_temp.must_eq('T1 observation delta=1', v_obs1 - v_obs0, 1);
  PERFORM pg_temp.must_eq('T1 canonical delta=1', v_co1 - v_co0, 1);
  PERFORM pg_temp.must_eq('T1 keeper-link delta=1', v_lnk1 - v_lnk0, 1);

  SELECT updated_at INTO v_canon_updated_a FROM public.canonical_opportunities WHERE id = v_canonical_id;

  -- ===== T2: re_seen_changed =====
  v_post_in_changed := v_post_in || jsonb_build_object(
    'description','Rev5 CHANGED description for the same fingerprint.',
    'location','Bergen');

  v_resp := public.careerjet_resolve_listing(
    v_run_id, v_token, v_fp_version, v_fp, v_post_in_changed,
    '[]'::jsonb, '[]'::jsonb);

  PERFORM pg_temp.must_eq('T2.action=re_seen_changed', v_resp->>'action', 're_seen_changed');
  v_canon := v_resp->'canonicalization';
  PERFORM pg_temp.must('T2.canonicalization present', v_canon IS NOT NULL);
  PERFORM pg_temp.must_eq('T2.canonical_created=false', (v_canon->>'canonical_created')::boolean, false);
  PERFORM pg_temp.must_eq('T2.keeper_link_created=false', (v_canon->>'keeper_link_created')::boolean, false);
  PERFORM pg_temp.must_eq('T2.already_linked=true', (v_canon->>'already_linked')::boolean, true);
  PERFORM pg_temp.must_eq('T2.thread_id stable', (v_resp->>'thread_id')::uuid, v_thread_id);
  PERFORM pg_temp.must_eq('T2.keeper stable', (v_resp->>'keeper_source_posting_id')::uuid, v_keeper_id);

  SELECT count(*) INTO v_th2 FROM public.careerjet_source_threads WHERE identity_fingerprint = v_fp;
  SELECT count(*) INTO v_sp2 FROM public.source_postings WHERE identity_fingerprint = v_fp;
  SELECT count(*) INTO v_co2 FROM public.canonical_opportunities WHERE identity_fingerprint = v_fp;
  SELECT count(*) INTO v_lnk2 FROM public.opportunity_source_links osl
    JOIN public.canonical_opportunities co ON co.id = osl.canonical_opportunity_id
    WHERE co.identity_fingerprint = v_fp;
  PERFORM pg_temp.must_eq('T2 thread delta=0', v_th2 - v_th1, 0);
  PERFORM pg_temp.must_eq('T2 source_posting delta=0', v_sp2 - v_sp1, 0);
  PERFORM pg_temp.must_eq('T2 canonical delta=0', v_co2 - v_co1, 0);
  PERFORM pg_temp.must_eq('T2 keeper-link delta=0', v_lnk2 - v_lnk1, 0);

  -- ===== T3: re_seen_noop (identical to T2 payload) =====
  v_post_in_noop := v_post_in_changed;
  -- Capture canonical.updated_at baseline (after T2 may have touched display)
  SELECT updated_at INTO v_canon_updated_a FROM public.canonical_opportunities WHERE id = v_canonical_id;

  v_resp := public.careerjet_resolve_listing(
    v_run_id, v_token, v_fp_version, v_fp, v_post_in_noop,
    '[]'::jsonb, '[]'::jsonb);

  PERFORM pg_temp.must_eq('T3.action=re_seen_noop', v_resp->>'action', 're_seen_noop');
  v_canon := v_resp->'canonicalization';
  PERFORM pg_temp.must('T3.canonicalization present', v_canon IS NOT NULL);
  PERFORM pg_temp.must_eq('T3.canonical_created=false', (v_canon->>'canonical_created')::boolean, false);
  PERFORM pg_temp.must_eq('T3.keeper_link_created=false', (v_canon->>'keeper_link_created')::boolean, false);
  PERFORM pg_temp.must_eq('T3.already_linked=true', (v_canon->>'already_linked')::boolean, true);
  PERFORM pg_temp.must_eq('T3.display_updated=false', (v_canon->>'display_updated')::boolean, false);
  PERFORM pg_temp.must_eq('T3.live_until_changed=false', (v_canon->>'live_until_changed')::boolean, false);

  SELECT count(*) INTO v_th3 FROM public.careerjet_source_threads WHERE identity_fingerprint = v_fp;
  SELECT count(*) INTO v_sp3 FROM public.source_postings WHERE identity_fingerprint = v_fp;
  SELECT count(*) INTO v_co3 FROM public.canonical_opportunities WHERE identity_fingerprint = v_fp;
  SELECT count(*) INTO v_lnk3 FROM public.opportunity_source_links osl
    JOIN public.canonical_opportunities co ON co.id = osl.canonical_opportunity_id
    WHERE co.identity_fingerprint = v_fp;
  SELECT count(*) INTO v_aud3 FROM public.careerjet_identity_audit WHERE run_id = v_run_id;
  SELECT count(*) INTO v_aud_canon3 FROM public.careerjet_identity_audit
    WHERE run_id = v_run_id AND action = 'canonicalize';

  PERFORM pg_temp.must_eq('T3 thread delta=0', v_th3 - v_th2, 0);
  PERFORM pg_temp.must_eq('T3 source_posting delta=0', v_sp3 - v_sp2, 0);
  PERFORM pg_temp.must_eq('T3 canonical delta=0', v_co3 - v_co2, 0);
  PERFORM pg_temp.must_eq('T3 keeper-link delta=0', v_lnk3 - v_lnk2, 0);

  SELECT updated_at INTO v_canon_updated_b FROM public.canonical_opportunities WHERE id = v_canonical_id;
  PERFORM pg_temp.must_eq('T3 canonical.updated_at stable', v_canon_updated_b, v_canon_updated_a);

  -- Final invariants after T1-T3
  PERFORM pg_temp.must_eq('final threads=1', v_th3 - v_th0, 1);
  PERFORM pg_temp.must_eq('final keeper postings=1', v_sp3 - v_sp0, 1);
  PERFORM pg_temp.must_eq('final canonicals=1', v_co3 - v_co0, 1);
  PERFORM pg_temp.must_eq('final keeper-links=1', v_lnk3 - v_lnk0, 1);
  -- canonicalize-audit only written when canonicalize actually mutated state.
  -- T1 mutates (creates canonical+link); T2 mutates (display_updated likely);
  -- T3 must NOT add a canonicalize-audit row.
  PERFORM pg_temp.must('canonicalize-audit count <= 2 after T1-T3',
                      (v_aud_canon3 - v_aud_canon0) <= 2);
  PERFORM pg_temp.must('canonicalize-audit count >= 1 after T1-T3',
                      (v_aud_canon3 - v_aud_canon0) >= 1);

  -- ===== T4: missing fingerprint => review path, no canonicalization key =====
  SELECT count(*) INTO v_t4_aud_before FROM public.careerjet_identity_audit WHERE run_id = v_run_id;
  SELECT count(*) INTO v_t4_co_before  FROM public.canonical_opportunities;
  SELECT count(*) INTO v_t4_lnk_before FROM public.opportunity_source_links;

  v_t4_resp := public.careerjet_resolve_listing(
    v_run_id, v_token, v_fp_version, NULL,
    v_post_in || jsonb_build_object(
      'raw_url','https://example.test/rev5/missing-fp',
      'raw_url_hash', encode(extensions.digest('rev5-missing','sha256'),'hex')),
    '[]'::jsonb, '[]'::jsonb);

  PERFORM pg_temp.must_eq('T4.action=review', v_t4_resp->>'action', 'review');
  PERFORM pg_temp.must('T4 has no canonicalization key', v_t4_resp->'canonicalization' IS NULL);

  SELECT count(*) INTO v_t4_aud_after FROM public.careerjet_identity_audit WHERE run_id = v_run_id;
  SELECT count(*) INTO v_t4_co_after  FROM public.canonical_opportunities;
  SELECT count(*) INTO v_t4_lnk_after FROM public.opportunity_source_links;
  PERFORM pg_temp.must_eq('T4 audit delta=0 (review path)', v_t4_aud_after - v_t4_aud_before, 0);
  PERFORM pg_temp.must_eq('T4 canonical delta=0', v_t4_co_after - v_t4_co_before, 0);
  PERFORM pg_temp.must_eq('T4 link delta=0', v_t4_lnk_after - v_t4_lnk_before, 0);

  -- ===== T5: invariant failure inside canonicalize rolls back whole RPC =====
  -- Build a synthetic inconsistent thread/keeper fixture: thread points at a
  -- keeper whose identity_role is 'variant' (not 'keeper'). resolver_listing
  -- will reach canonicalize with a valid lease, and canonicalize raises
  -- 'keeper_role_not_keeper'. The whole resolver RPC must roll back: no
  -- thread/keeper observation rows for the synthetic fingerprint may persist.
  v_t5_fp := encode(extensions.digest('rev5-t5-'||v_run_id::text,'sha256'),'hex');

  -- Pre-create the inconsistent fixture OUTSIDE the resolver call.
  INSERT INTO public.source_postings (
    id, source, source_external_id, raw_url, display_url,
    title, company, location, description_excerpt, raw_payload,
    identity_fingerprint, identity_thread_id, posting_status, last_seen_at,
    identity_role, identity_fp_version, identity_resolved_at
  ) VALUES (
    v_t5_keeper_id, 'careerjet',
    public._careerjet_thread_key(v_fp_version, v_t5_fp, 1),
    'https://example.test/rev5/t5','https://example.test/rev5/t5',
    'Rev5 T5 Title','Rev5 T5 AS','Oslo','Rev5 T5 description',
    jsonb_build_object('site','example.test','employment','{}'::jsonb),
    v_t5_fp, v_t5_thread_id, 'active', now(),
    'variant', -- <-- inconsistency: role is not 'keeper'
    v_fp_version, now()
  );
  INSERT INTO public.careerjet_source_threads (
    id, identity_fingerprint, fp_version, generation, thread_key,
    keeper_source_posting_id, stable_content_hash, stable_content_hash_version,
    first_seen_run_id, last_seen_run_id, last_seen_at, state
  ) VALUES (
    v_t5_thread_id, v_t5_fp, v_fp_version, 1,
    public._careerjet_thread_key(v_fp_version, v_t5_fp, 1),
    v_t5_keeper_id,
    public._careerjet_stable_hash_v1('Rev5 T5 Title','Rev5 T5 AS','Oslo','Rev5 T5 description','example.test','{}'::jsonb),
    1, v_run_id, v_run_id, now(), 'active'
  );

  -- Scoped baseline for T5 (after fixture is in place, before resolver call).
  SELECT count(*) INTO v_t5_th_before  FROM public.careerjet_source_threads WHERE identity_fingerprint = v_t5_fp;
  SELECT count(*) INTO v_t5_sp_before  FROM public.source_postings WHERE identity_fingerprint = v_t5_fp;
  SELECT count(*) INTO v_t5_obs_before FROM public.careerjet_source_observations WHERE sync_run_id = v_run_id;
  SELECT count(*) INTO v_t5_co_before  FROM public.canonical_opportunities WHERE identity_fingerprint = v_t5_fp;
  SELECT count(*) INTO v_t5_lnk_before FROM public.opportunity_source_links osl
    JOIN public.canonical_opportunities co ON co.id = osl.canonical_opportunity_id
    WHERE co.identity_fingerprint = v_t5_fp;
  SELECT count(*) INTO v_t5_aud_before FROM public.careerjet_identity_audit WHERE run_id = v_run_id;

  BEGIN
    PERFORM public.careerjet_resolve_listing(
      v_run_id, v_token, v_fp_version, v_t5_fp,
      v_post_in || jsonb_build_object(
        'raw_url','https://example.test/rev5/t5b',
        'raw_url_hash', encode(extensions.digest('rev5-t5b','sha256'),'hex')),
      '[]'::jsonb, '[]'::jsonb);
    PERFORM pg_temp.must('T5 expected canonicalize error not raised', false);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_t5_caught := SQLERRM;
  END;

  PERFORM pg_temp.must('T5 caught keeper_role_not_keeper', v_t5_caught LIKE 'keeper_role_not_keeper%');

  SELECT count(*) INTO v_t5_th_after  FROM public.careerjet_source_threads WHERE identity_fingerprint = v_t5_fp;
  SELECT count(*) INTO v_t5_sp_after  FROM public.source_postings WHERE identity_fingerprint = v_t5_fp;
  SELECT count(*) INTO v_t5_obs_after FROM public.careerjet_source_observations WHERE sync_run_id = v_run_id;
  SELECT count(*) INTO v_t5_co_after  FROM public.canonical_opportunities WHERE identity_fingerprint = v_t5_fp;
  SELECT count(*) INTO v_t5_lnk_after FROM public.opportunity_source_links osl
    JOIN public.canonical_opportunities co ON co.id = osl.canonical_opportunity_id
    WHERE co.identity_fingerprint = v_t5_fp;
  SELECT count(*) INTO v_t5_aud_after FROM public.careerjet_identity_audit WHERE run_id = v_run_id;

  -- The resolver call rolled back via the BEGIN/EXCEPTION subtxn above,
  -- so NO new rows for v_t5_fp may exist after the failed call.
  PERFORM pg_temp.must_eq('T5 thread delta=0',         v_t5_th_after  - v_t5_th_before,  0);
  PERFORM pg_temp.must_eq('T5 source_posting delta=0', v_t5_sp_after  - v_t5_sp_before,  0);
  PERFORM pg_temp.must_eq('T5 observation delta=0',    v_t5_obs_after - v_t5_obs_before, 0);
  PERFORM pg_temp.must_eq('T5 canonical delta=0',      v_t5_co_after  - v_t5_co_before,  0);
  PERFORM pg_temp.must_eq('T5 link delta=0',           v_t5_lnk_after - v_t5_lnk_before, 0);
  PERFORM pg_temp.must_eq('T5 audit delta=0',          v_t5_aud_after - v_t5_aud_before, 0);

  RAISE NOTICE 'REV5 resolver-wiring tests PASS: T1 first_sight, T2 re_seen_changed, T3 re_seen_noop, T4 missing-fp review, T5 invariant rollback.';
END $body$;

ROLLBACK;
