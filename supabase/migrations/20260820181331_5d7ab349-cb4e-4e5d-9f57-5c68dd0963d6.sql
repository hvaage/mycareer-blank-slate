CREATE OR REPLACE FUNCTION public.linkedin_reconciliation_phase3_canary()
RETURNS TABLE(check_name text, passed boolean, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v jsonb := '[]'::jsonb;
  u_a uuid := '00000000-0000-4000-8000-00000000a001';
  u_b uuid := '00000000-0000-4000-8000-00000000b002';
  imp_a uuid; imp_b uuid;
  att_a uuid := gen_random_uuid();
  run_a uuid; run_a2 uuid;
  sr_a uuid; sr_b uuid;
  p_create uuid; p_conflict uuid; p_super uuid;
  before_counts jsonb; after_counts jsonb;
  res jsonb;
  n int; s text; b boolean;
BEGIN
  BEGIN
    SELECT jsonb_build_object(
      'profiles', (SELECT count(*) FROM public.profiles),
      'user_career_profiles', (SELECT count(*) FROM public.user_career_profiles),
      'career_atoms', (SELECT count(*) FROM public.career_atoms),
      'career_atom_links', (SELECT count(*) FROM public.career_atom_links),
      'contacts', (SELECT count(*) FROM public.contacts),
      'job_leads', (SELECT count(*) FROM public.job_leads),
      'user_opportunities', (SELECT count(*) FROM public.user_opportunities),
      'job_applications', (SELECT count(*) FROM public.job_applications),
      'documents', (SELECT count(*) FROM public.documents),
      'cv_claim_attestations', (SELECT count(*) FROM public.cv_claim_attestations),
      'cv_parse_candidates', (SELECT count(*) FROM public.cv_parse_candidates),
      'professional_results', (SELECT count(*) FROM public.professional_results),
      'professional_cases', (SELECT count(*) FROM public.professional_cases)
    ) INTO before_counts;

    INSERT INTO public.linkedin_imports (user_id, archive_sha256, status, archive_available, attempt_id, staged_record_count)
    VALUES (u_a, repeat('a', 64), 'staged', true, att_a, 2) RETURNING id INTO imp_a;
    INSERT INTO public.linkedin_imports (user_id, archive_sha256, status, archive_available, attempt_id, staged_record_count)
    VALUES (u_b, repeat('b', 64), 'staged', false, gen_random_uuid(), 1) RETURNING id INTO imp_b;

    INSERT INTO public.linkedin_import_purposes (linkedin_import_id, user_id, purpose)
    VALUES (imp_a, u_a, 'profile'), (imp_a, u_a, 'career');

    INSERT INTO public.linkedin_staging_records
      (user_id, staging_domain, record_kind, purpose, source_system, source_file,
       source_locator_type, source_locator, source_row_number, source_row_hash,
       source_classification, source_identity_hash, first_linkedin_import_id, last_linkedin_import_id)
    VALUES (u_a, 'career', 'position', 'career', 'linkedin_export', 'Positions.csv',
       'csv_row', 'Positions.csv#2', 2, repeat('1', 64), 'A', repeat('c', 64), imp_a, imp_a)
    RETURNING id INTO sr_a;

    INSERT INTO public.linkedin_staging_records
      (user_id, staging_domain, record_kind, purpose, source_system, source_file,
       source_locator_type, source_locator, source_row_number, source_row_hash,
       source_classification, source_identity_hash, first_linkedin_import_id, last_linkedin_import_id)
    VALUES (u_b, 'career', 'position', 'career', 'linkedin_export', 'Positions.csv',
       'csv_row', 'Positions.csv#2', 2, repeat('2', 64), 'A', repeat('d', 64), imp_b, imp_b)
    RETURNING id INTO sr_b;

    INSERT INTO public.linkedin_import_stage_records
      (linkedin_import_id, attempt_id, user_id, staging_record_id, staging_domain, purpose, source_identity_hash)
    VALUES (imp_a, att_a, u_a, sr_a, 'career', 'career', repeat('c', 64));

    INSERT INTO public.linkedin_reconciliation_runs
      (user_id, linkedin_import_id, purpose, status, input_signature, source_record_count)
    VALUES (u_a, imp_a, 'career', 'succeeded', 'sig-canary-1', 1) RETURNING id INTO run_a;

    BEGIN
      INSERT INTO public.linkedin_reconciliation_runs
        (user_id, linkedin_import_id, purpose, status, input_signature)
      VALUES (u_a, imp_a, 'career', 'queued', 'sig-canary-1');
      v := v || jsonb_build_object('n','idempotens: duplikat inputsignatur avvises','p',false,'d','INSERT gikk gjennom');
    EXCEPTION WHEN unique_violation THEN
      v := v || jsonb_build_object('n','idempotens: duplikat inputsignatur avvises','p',true,'d','unique_violation');
    END;

    INSERT INTO public.linkedin_reconciliation_runs
      (user_id, linkedin_import_id, purpose, status, input_signature, reconciliation_version)
    VALUES (u_a, imp_a, 'career', 'succeeded', 'sig-canary-2', 'linkedin_reconciliation_v2')
    RETURNING id INTO run_a2;
    v := v || jsonb_build_object('n','idempotens: ny regelversjon gir ny kjøring','p',run_a2 IS NOT NULL,'d','ny run opprettet');

    INSERT INTO public.linkedin_reconciliation_proposals
      (user_id, reconciliation_run_id, linkedin_import_id, purpose, proposal_domain, proposal_kind,
       confidence, match_method, dedupe_key, source_snapshot_json, source_snapshot_hash,
       proposed_payload_json, comparison_json, review_message)
    VALUES (u_a, run_a, imp_a, 'career', 'career', 'create', 0.9, 'normalized_key', 'career:acme:cto',
       '{"title":"CTO","company":"Acme"}'::jsonb, repeat('e', 64),
       '{"title":"CTO"}'::jsonb, '{"diff":["title"]}'::jsonb, 'Ny rolle fra LinkedIn-eksporten')
    RETURNING id INTO p_create;

    INSERT INTO public.linkedin_reconciliation_proposals
      (user_id, reconciliation_run_id, linkedin_import_id, purpose, proposal_domain, proposal_kind,
       confidence, match_method, dedupe_key, source_snapshot_json, source_snapshot_hash, status)
    VALUES (u_a, run_a, imp_a, 'career', 'career', 'conflict', 0.4, 'fuzzy_name_period', 'career:acme:coo',
       '{"title":"COO"}'::jsonb, repeat('f', 64), 'pending_review')
    RETURNING id INTO p_conflict;

    INSERT INTO public.linkedin_reconciliation_proposals
      (user_id, reconciliation_run_id, linkedin_import_id, purpose, proposal_domain, proposal_kind,
       confidence, match_method, dedupe_key, source_snapshot_json, source_snapshot_hash, status)
    VALUES (u_a, run_a2, imp_a, 'career', 'career', 'create', 0.9, 'normalized_key', 'career:acme:cto',
       '{"title":"CTO"}'::jsonb, repeat('e', 64), 'superseded')
    RETURNING id INTO p_super;

    INSERT INTO public.linkedin_reconciliation_proposal_sources
      (proposal_id, user_id, linkedin_staging_record_id, source_role, source_reference_json)
    VALUES (p_create, u_a, sr_a, 'primary', '{"file":"Positions.csv","row":2}'::jsonb);

    BEGIN
      INSERT INTO public.linkedin_reconciliation_proposals
        (user_id, reconciliation_run_id, linkedin_import_id, purpose, proposal_domain, proposal_kind,
         dedupe_key, source_snapshot_json, source_snapshot_hash)
      VALUES (u_a, run_a, imp_a, 'career', 'career', 'create', 'career:acme:cto', '{}'::jsonb, repeat('e', 64));
      v := v || jsonb_build_object('n','idempotens: duplikat dedupe_key i samme kjøring avvises','p',false,'d','INSERT gikk gjennom');
    EXCEPTION WHEN unique_violation THEN
      v := v || jsonb_build_object('n','idempotens: duplikat dedupe_key i samme kjøring avvises','p',true,'d','unique_violation');
    END;

    BEGIN
      INSERT INTO public.linkedin_reconciliation_proposal_sources
        (proposal_id, user_id, linkedin_staging_record_id, source_role)
      VALUES (p_create, u_a, sr_b, 'primary');
      v := v || jsonb_build_object('n','kryssbruker: forslag kan ikke peke på annen brukers staging','p',false,'d','FK slapp gjennom');
    EXCEPTION WHEN foreign_key_violation THEN
      v := v || jsonb_build_object('n','kryssbruker: forslag kan ikke peke på annen brukers staging','p',true,'d','foreign_key_violation');
    END;

    BEGIN
      INSERT INTO public.linkedin_reconciliation_proposals
        (user_id, reconciliation_run_id, linkedin_import_id, purpose, proposal_domain, proposal_kind,
         dedupe_key, source_snapshot_json, source_snapshot_hash)
      VALUES (u_b, run_a, imp_a, 'career', 'career', 'create', 'x', '{}'::jsonb, repeat('e', 64));
      v := v || jsonb_build_object('n','kryssbruker: forslag kan ikke henge på annen brukers kjøring','p',false,'d','FK slapp gjennom');
    EXCEPTION WHEN foreign_key_violation THEN
      v := v || jsonb_build_object('n','kryssbruker: forslag kan ikke henge på annen brukers kjøring','p',true,'d','foreign_key_violation');
    END;

    SELECT bool_and(NOT has_table_privilege('anon', t, 'SELECT')
                AND NOT has_table_privilege('anon', t, 'INSERT'))
      INTO b
      FROM unnest(ARRAY['public.linkedin_reconciliation_runs','public.linkedin_reconciliation_proposals',
                        'public.linkedin_reconciliation_proposal_sources','public.linkedin_reconciliation_decisions']) AS t;
    v := v || jsonb_build_object('n','tilgang: anon har ingen tilgang til avstemmingstabellene','p', b,'d','ingen SELECT/INSERT for anon');

    SELECT bool_and(has_table_privilege('authenticated', t, 'SELECT')
                AND NOT has_table_privilege('authenticated', t, 'INSERT')
                AND NOT has_table_privilege('authenticated', t, 'UPDATE')
                AND NOT has_table_privilege('authenticated', t, 'DELETE'))
      INTO b
      FROM unnest(ARRAY['public.linkedin_reconciliation_runs','public.linkedin_reconciliation_proposals',
                        'public.linkedin_reconciliation_proposal_sources','public.linkedin_reconciliation_decisions']) AS t;
    v := v || jsonb_build_object('n','tilgang: innlogget bruker kan kun lese, aldri skrive direkte','p', b,'d','kun SELECT for authenticated');

    SELECT bool_and(c.relrowsecurity) INTO b
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'linkedin_reconciliation%';
    v := v || jsonb_build_object('n','tilgang: RLS er på for alle avstemmingstabeller','p', b,'d','relrowsecurity = true');

    SELECT count(*) INTO n FROM pg_policies
     WHERE schemaname = 'public' AND tablename LIKE 'linkedin_reconciliation%'
       AND cmd = 'SELECT' AND roles = '{authenticated}' AND qual ILIKE '%auth.uid() = user_id%';
    v := v || jsonb_build_object('n','RLS: eierpolicy (auth.uid() = user_id) på alle fire tabeller','p', n = 4,'d','policyer: '||n);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO n FROM public.linkedin_reconciliation_proposals WHERE user_id = auth.uid();
    v := v || jsonb_build_object('n','RLS-predikat: bruker A matcher kun egne forslag','p', n = 3,'d','treff: '||n);

    SELECT public.linkedin_reconciliation_decide(p_create, 'defer') INTO res;
    v := v || jsonb_build_object('n','beslutning: defer gir deferred_by_user','p', res->>'status' = 'deferred_by_user','d',res::text);

    SELECT public.linkedin_reconciliation_decide(p_create, 'approve_for_promotion', NULL, 'ok å bruke senere') INTO res;
    v := v || jsonb_build_object('n','beslutning: approve gir approved_for_promotion','p', res->>'status' = 'approved_for_promotion','d',res::text);

    SELECT public.linkedin_reconciliation_decide(p_conflict, 'dismiss', 'keep_existing') INTO res;
    v := v || jsonb_build_object('n','beslutning: behold eksisterende gir dismissed','p', res->>'status' = 'dismissed','d',res::text);

    SELECT public.linkedin_reconciliation_decide(p_super, 'approve_for_promotion') INTO res;
    v := v || jsonb_build_object('n','beslutning: superseded forslag er ikke handlingsbart','p', res->>'error' = 'proposal_not_actionable','d',res::text);

    SELECT count(*) INTO n FROM public.linkedin_reconciliation_decisions WHERE proposal_id = p_create;
    SELECT (count(*) = 1) INTO b FROM public.linkedin_reconciliation_decisions
      WHERE proposal_id = p_create AND supersedes_decision_id IS NOT NULL;
    v := v || jsonb_build_object('n','historikk: append-only kjede med supersedes','p', n = 2 AND b, 'd','beslutninger: '||n);

    BEGIN
      DELETE FROM public.linkedin_reconciliation_decisions WHERE proposal_id = p_create;
      v := v || jsonb_build_object('n','historikk: sletting blokkeres','p',false,'d','DELETE gikk gjennom');
    EXCEPTION WHEN OTHERS THEN
      v := v || jsonb_build_object('n','historikk: sletting blokkeres','p',true,'d',SQLERRM);
    END;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO n FROM public.linkedin_reconciliation_proposals WHERE user_id = auth.uid();
    v := v || jsonb_build_object('n','RLS-predikat: bruker B matcher ingen av A sine forslag','p', n = 0, 'd','treff: '||n);

    SELECT public.linkedin_reconciliation_decide(p_conflict, 'approve_for_promotion') INTO res;
    v := v || jsonb_build_object('n','kryssbruker: B kan ikke beslutte på A sitt forslag','p', res->>'error' = 'proposal_not_found','d',res::text);

    PERFORM set_config('request.jwt.claims', NULL, true);

    SELECT public.linkedin_import_delete(imp_a, 'retention_purge') INTO res;
    v := v || jsonb_build_object('n','retention: sletting rapporterer minimerte forslag','p', (res->>'ok')::boolean AND (res->>'stale_proposals')::int >= 1,'d',res::text);

    SELECT status INTO s FROM public.linkedin_reconciliation_proposals WHERE id = p_create;
    v := v || jsonb_build_object('n','retention: forslag settes til stale_source','p', s = 'stale_source','d','status: '||s);

    SELECT (source_snapshot_json = '{}'::jsonb AND proposed_payload_json IS NULL
            AND target_snapshot_json IS NULL AND comparison_json = '{}'::jsonb
            AND review_message IS NULL AND minimized_at IS NOT NULL)
      INTO b FROM public.linkedin_reconciliation_proposals WHERE id = p_create;
    v := v || jsonb_build_object('n','retention: innhold fjernet fra forslaget','p', b,'d','payload/snapshot/comparison tømt');

    SELECT (id IS NOT NULL AND proposal_domain = 'career' AND proposal_kind = 'create'
            AND source_classification = 'A' AND source_snapshot_hash IS NOT NULL
            AND linkedin_import_id IS NOT NULL)
      INTO b FROM public.linkedin_reconciliation_proposals WHERE id = p_create;
    v := v || jsonb_build_object('n','retention: minimalt revisjonsspor beholdes','p', b,'d','id, domene, type, klasse, hash, import-id, tidspunkt');

    SELECT count(*) INTO n FROM public.linkedin_reconciliation_proposal_sources WHERE proposal_id = p_create;
    v := v || jsonb_build_object('n','retention: kildekoblinger mot slettet staging fjernes','p', n = 0,'d','koblinger igjen: '||n);

    SELECT count(*) INTO n FROM public.linkedin_reconciliation_decisions WHERE proposal_id = p_create;
    v := v || jsonb_build_object('n','retention: beslutningshistorikk overlever minimering','p', n = 2,'d','beslutninger: '||n);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
    SELECT public.linkedin_reconciliation_decide(p_create, 'approve_for_promotion') INTO res;
    v := v || jsonb_build_object('n','retention: stale_source blokkerer nye beslutninger','p', res->>'error' = 'proposal_not_actionable','d',res::text);
    PERFORM set_config('request.jwt.claims', NULL, true);

    SELECT jsonb_build_object(
      'profiles', (SELECT count(*) FROM public.profiles),
      'user_career_profiles', (SELECT count(*) FROM public.user_career_profiles),
      'career_atoms', (SELECT count(*) FROM public.career_atoms),
      'career_atom_links', (SELECT count(*) FROM public.career_atom_links),
      'contacts', (SELECT count(*) FROM public.contacts),
      'job_leads', (SELECT count(*) FROM public.job_leads),
      'user_opportunities', (SELECT count(*) FROM public.user_opportunities),
      'job_applications', (SELECT count(*) FROM public.job_applications),
      'documents', (SELECT count(*) FROM public.documents),
      'cv_claim_attestations', (SELECT count(*) FROM public.cv_claim_attestations),
      'cv_parse_candidates', (SELECT count(*) FROM public.cv_parse_candidates),
      'professional_results', (SELECT count(*) FROM public.professional_results),
      'professional_cases', (SELECT count(*) FROM public.professional_cases)
    ) INTO after_counts;

    v := v || jsonb_build_object('n','produktdata: før/etter-tellinger identiske','p', before_counts = after_counts,
                                 'd', 'før='||before_counts::text||' etter='||after_counts::text);

    RAISE EXCEPTION 'CANARY_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'CANARY_ROLLBACK' THEN
      v := v || jsonb_build_object('n','canary avbrutt med uventet feil','p',false,'d',SQLERRM);
    END IF;
  END;

  RETURN QUERY
  SELECT e->>'n', (e->>'p')::boolean, e->>'d'
  FROM jsonb_array_elements(v) AS e;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.linkedin_reconciliation_phase3_canary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.linkedin_reconciliation_phase3_canary() TO service_role;