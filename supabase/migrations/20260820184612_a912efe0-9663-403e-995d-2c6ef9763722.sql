CREATE OR REPLACE FUNCTION public.linkedin_promotion_phase4_canary()
RETURNS TABLE(check_name text, passed boolean, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v jsonb := '[]'::jsonb;
  u_a uuid := '00000000-0000-4000-8000-00000000a401';
  u_b uuid := '00000000-0000-4000-8000-00000000b402';
  imp_a uuid; imp_b uuid;
  att_a uuid := gen_random_uuid();
  run_a uuid; run_b uuid;
  p_rec uuid; p_net uuid; p_pending uuid; p_career uuid; p_b uuid;
  before_counts jsonb; after_counts jsonb;
  res jsonb; res2 jsonb;
  ev uuid;
  n int;
BEGIN
  BEGIN
    SELECT jsonb_build_object(
      'profiles', (SELECT count(*) FROM public.profiles),
      'user_career_profiles', (SELECT count(*) FROM public.user_career_profiles),
      'career_atoms', (SELECT count(*) FROM public.career_atoms),
      'career_atom_links', (SELECT count(*) FROM public.career_atom_links),
      'job_leads', (SELECT count(*) FROM public.job_leads),
      'professional_results', (SELECT count(*) FROM public.professional_results),
      'documents', (SELECT count(*) FROM public.documents)
    ) INTO before_counts;

    INSERT INTO public.linkedin_imports (user_id, archive_sha256, status, archive_available, attempt_id, staged_record_count)
    VALUES (u_a, repeat('4', 64), 'staged', true, att_a, 3) RETURNING id INTO imp_a;
    INSERT INTO public.linkedin_imports (user_id, archive_sha256, status, archive_available, attempt_id, staged_record_count)
    VALUES (u_b, repeat('5', 64), 'staged', true, gen_random_uuid(), 1) RETURNING id INTO imp_b;

    INSERT INTO public.linkedin_import_purposes (linkedin_import_id, user_id, purpose)
    VALUES (imp_a, u_a, 'career'), (imp_a, u_a, 'network');
    INSERT INTO public.linkedin_import_purposes (linkedin_import_id, user_id, purpose)
    VALUES (imp_b, u_b, 'career');

    INSERT INTO public.linkedin_reconciliation_runs
      (user_id, linkedin_import_id, purpose, status, input_signature, source_record_count)
    VALUES (u_a, imp_a, 'career', 'succeeded', 'sig-p4-1', 3) RETURNING id INTO run_a;

    INSERT INTO public.linkedin_reconciliation_runs
      (user_id, linkedin_import_id, purpose, status, input_signature, source_record_count)
    VALUES (u_b, imp_b, 'career', 'succeeded', 'sig-p4-b', 1) RETURNING id INTO run_b;

    INSERT INTO public.linkedin_reconciliation_proposals
      (user_id, reconciliation_run_id, linkedin_import_id, purpose, proposal_domain, proposal_kind,
       confidence, match_method, dedupe_key, source_snapshot_json, source_snapshot_hash,
       proposed_payload_json, status, source_classification)
    VALUES (u_a, run_a, imp_a, 'career', 'recommendations', 'create', 0.9, 'normalized_key', 'rec:1',
       '{"author_name":"Kari Nordmann"}'::jsonb, repeat('1', 64),
       '{"author_name":"Kari Nordmann","text":"God samarbeidspartner."}'::jsonb,
       'approved_for_promotion', 'A')
    RETURNING id INTO p_rec;

    INSERT INTO public.linkedin_reconciliation_proposals
      (user_id, reconciliation_run_id, linkedin_import_id, purpose, proposal_domain, proposal_kind,
       confidence, match_method, dedupe_key, source_snapshot_json, source_snapshot_hash,
       proposed_payload_json, status, source_classification)
    VALUES (u_a, run_a, imp_a, 'network', 'network', 'create', 0.8, 'normalized_key', 'net:1',
       '{"first_name":"Ola"}'::jsonb, repeat('2', 64),
       '{"first_name":"Ola","last_name":"Hansen","profile_url":"https://linkedin.com/in/olahansen"}'::jsonb,
       'approved_for_promotion', 'A')
    RETURNING id INTO p_net;

    INSERT INTO public.linkedin_reconciliation_proposals
      (user_id, reconciliation_run_id, linkedin_import_id, purpose, proposal_domain, proposal_kind,
       confidence, match_method, dedupe_key, source_snapshot_json, source_snapshot_hash,
       proposed_payload_json, status, source_classification)
    VALUES (u_a, run_a, imp_a, 'career', 'recommendations', 'create', 0.7, 'normalized_key', 'rec:2',
       '{"author_name":"Per"}'::jsonb, repeat('3', 64),
       '{"author_name":"Per","text":"Solid leveranse."}'::jsonb, 'pending_review', 'A')
    RETURNING id INTO p_pending;

    INSERT INTO public.linkedin_reconciliation_proposals
      (user_id, reconciliation_run_id, linkedin_import_id, purpose, proposal_domain, proposal_kind,
       confidence, match_method, dedupe_key, source_snapshot_json, source_snapshot_hash,
       proposed_payload_json, status, source_classification)
    VALUES (u_a, run_a, imp_a, 'career', 'career', 'create', 0.9, 'normalized_key', 'career:1',
       '{"title":"CTO"}'::jsonb, repeat('6', 64),
       '{"title":"CTO","company":"Acme"}'::jsonb, 'approved_for_promotion', 'A')
    RETURNING id INTO p_career;

    INSERT INTO public.linkedin_reconciliation_proposals
      (user_id, reconciliation_run_id, linkedin_import_id, purpose, proposal_domain, proposal_kind,
       confidence, match_method, dedupe_key, source_snapshot_json, source_snapshot_hash,
       proposed_payload_json, status, source_classification)
    VALUES (u_b, run_b, imp_b, 'career', 'recommendations', 'create', 0.9, 'normalized_key', 'rec:b',
       '{"author_name":"Bruker B"}'::jsonb, repeat('7', 64),
       '{"author_name":"Bruker B","text":"Annen bruker."}'::jsonb, 'approved_for_promotion', 'A')
    RETURNING id INTO p_b;

    PERFORM set_config('request.jwt.claims', NULL, true);
    SELECT public.linkedin_promote_recommendation(p_rec, 'create_new') INTO res;
    v := v || jsonb_build_object('n','promotering krever innlogget bruker','p', res->>'error_code' = 'not_authenticated','d',res::text);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);

    SELECT public.linkedin_promote_recommendation(p_rec, 'keep_existing') INTO res;
    v := v || jsonb_build_object('n','keep_existing avvises av promoterings-RPC','p', res->>'error_code' = 'resolution_requires_decision_layer','d',res::text);
    SELECT public.linkedin_promote_recommendation(p_rec, 'manual_edit_required') INTO res;
    v := v || jsonb_build_object('n','manual_edit_required avvises av promoterings-RPC','p', res->>'error_code' = 'resolution_requires_decision_layer','d',res::text);

    SELECT public.linkedin_promote_recommendation(p_pending, 'create_new') INTO res;
    v := v || jsonb_build_object('n','ikke-godkjent forslag blokkeres','p', res->>'error_code' = 'not_approved_for_promotion','d',res::text);

    SELECT public.linkedin_promote_network_contact(p_rec, 'create_new') INTO res;
    v := v || jsonb_build_object('n','forslag kan kun promoteres via riktig domeneport','p', res->>'error_code' = 'wrong_promotion_port','d',res::text);

    SELECT public.linkedin_promote_recommendation(p_rec, 'create_new') INTO res;
    v := v || jsonb_build_object('n','anbefaling promoteres','p', (res->>'ok')::boolean IS TRUE,'d',res::text);

    SELECT count(*) INTO n FROM public.career_recommendations WHERE user_id = u_a;
    v := v || jsonb_build_object('n','anbefaling skrevet til produktmodellen','p', n = 1,'d','rader: '||n);

    SELECT count(*) INTO n FROM public.linkedin_promotion_events
    WHERE proposal_id = p_rec AND promotion_status = 'promoted';
    v := v || jsonb_build_object('n','suksesshendelse skrevet','p', n = 1,'d','hendelser: '||n);

    SELECT count(*) INTO n FROM public.linkedin_promotion_targets t
    JOIN public.linkedin_promotion_events e ON e.id = t.promotion_event_id
    WHERE e.proposal_id = p_rec AND t.entity_type = 'career_recommendation' AND t.user_id = u_a;
    v := v || jsonb_build_object('n','revisjonsreferanse til produktrad lagret','p', n = 1,'d','mål: '||n);

    SELECT to_jsonb(status) INTO res FROM public.linkedin_reconciliation_proposals WHERE id = p_rec;
    v := v || jsonb_build_object('n','forslaget settes til promoted','p', res #>> '{}' = 'promoted','d',res::text);

    SELECT public.linkedin_promote_recommendation(p_rec, 'create_new') INTO res2;
    v := v || jsonb_build_object('n','gjentatt promotering avvises','p', res2->>'error_code' = 'already_promoted','d',res2::text);

    SELECT count(*) INTO n FROM public.career_recommendations WHERE user_id = u_a;
    v := v || jsonb_build_object('n','gjentatt promotering gir ingen dublett','p', n = 1,'d','rader: '||n);

    SELECT count(*) INTO n FROM public.linkedin_promotion_events WHERE proposal_id = p_rec;
    v := v || jsonb_build_object('n','gjentatt promotering gir ingen ny hendelse','p', n = 1,'d','hendelser: '||n);

    SELECT public.linkedin_promote_network_contact(p_net, 'create_new') INTO res;
    v := v || jsonb_build_object('n','nettverkskontakt promoteres','p', (res->>'ok')::boolean IS TRUE,'d',res::text);
    SELECT count(*) INTO n FROM public.network_contacts WHERE user_id = u_a;
    v := v || jsonb_build_object('n','nettverkskontakt skrevet én gang','p', n = 1,'d','rader: '||n);

    SELECT public.linkedin_promote_career_record(p_career, 'create_new') INTO res;
    v := v || jsonb_build_object('n','skrivefeil gir retrybar feilkode, ikke unntak','p',
      (res->>'ok')::boolean IS FALSE AND res->>'error_code' = 'promotion_write_failed','d',res::text);

    SELECT count(*) INTO n FROM public.linkedin_promotion_events WHERE proposal_id = p_career;
    v := v || jsonb_build_object('n','mislykket promotering skriver ingen suksesshendelse','p', n = 0,'d','hendelser: '||n);

    SELECT count(*) INTO n FROM public.career_atoms WHERE user_id = u_a;
    v := v || jsonb_build_object('n','mislykket promotering ruller tilbake produktendring','p', n = 0,'d','atomer: '||n);

    SELECT public.linkedin_promotion_record_failure(p_career, 'promote_career_record', 'promotion_write_failed', true, 'Kunne ikke lagre rollen.') INTO res;
    v := v || jsonb_build_object('n','feilhendelse registreres separat','p', (res->>'ok')::boolean IS TRUE,'d',res::text);

    SELECT count(*) INTO n FROM public.linkedin_promotion_events
    WHERE proposal_id = p_career AND promotion_status = 'promotion_failed';
    v := v || jsonb_build_object('n','feilhendelse er lagret','p', n = 1,'d','hendelser: '||n);

    SELECT to_jsonb(status) INTO res FROM public.linkedin_reconciliation_proposals WHERE id = p_career;
    v := v || jsonb_build_object('n','retrybar feil lar forslaget stå godkjent','p', res #>> '{}' = 'approved_for_promotion','d',res::text);

    SELECT public.linkedin_promotion_record_failure(p_career, 'promote_career_record', 'empty_source_value', false, 'Mangler innhold.') INTO res;
    SELECT to_jsonb(status) INTO res2 FROM public.linkedin_reconciliation_proposals WHERE id = p_career;
    v := v || jsonb_build_object('n','ikke-retrybar feil låser forslaget','p', res2 #>> '{}' = 'promotion_failed','d',res2::text);

    SELECT public.linkedin_promotion_reopen(p_career) INTO res;
    SELECT to_jsonb(status) INTO res2 FROM public.linkedin_reconciliation_proposals WHERE id = p_career;
    v := v || jsonb_build_object('n','feilet forslag kan gjenåpnes for ny beslutning','p',
      (res->>'ok')::boolean IS TRUE AND res2 #>> '{}' = 'needs_resolution','d',res2::text);

    SELECT id INTO ev FROM public.linkedin_promotion_events WHERE proposal_id = p_rec LIMIT 1;
    BEGIN
      UPDATE public.linkedin_promotion_events SET error_code = 'tuklet' WHERE id = ev;
      v := v || jsonb_build_object('n','hendelseslogg kan ikke endres','p',false,'d','UPDATE gikk gjennom');
    EXCEPTION WHEN OTHERS THEN
      v := v || jsonb_build_object('n','hendelseslogg kan ikke endres','p',true,'d',SQLERRM);
    END;
    BEGIN
      DELETE FROM public.linkedin_promotion_events WHERE id = ev;
      v := v || jsonb_build_object('n','hendelseslogg kan ikke slettes','p',false,'d','DELETE gikk gjennom');
    EXCEPTION WHEN OTHERS THEN
      v := v || jsonb_build_object('n','hendelseslogg kan ikke slettes','p',true,'d',SQLERRM);
    END;

    SELECT public.linkedin_promote_recommendation(p_b, 'create_new') INTO res;
    v := v || jsonb_build_object('n','bruker A kan ikke promotere bruker B sitt forslag','p',
      res->>'error_code' = 'proposal_not_found','d',res::text);

    SELECT public.linkedin_promotion_record_failure(p_b, 'promote_recommendation', 'promotion_write_failed', true, NULL) INTO res;
    v := v || jsonb_build_object('n','bruker A kan ikke skrive feilhendelse for bruker B','p',
      res->>'error' = 'proposal_not_found','d',res::text);

    SELECT count(*) INTO n FROM public.career_recommendations WHERE user_id = u_b;
    v := v || jsonb_build_object('n','bruker B har ingen promoterte rader','p', n = 0,'d','rader: '||n);

    PERFORM set_config('request.jwt.claims', NULL, true);

    SELECT jsonb_build_object(
      'profiles', (SELECT count(*) FROM public.profiles),
      'user_career_profiles', (SELECT count(*) FROM public.user_career_profiles),
      'career_atoms', (SELECT count(*) FROM public.career_atoms),
      'career_atom_links', (SELECT count(*) FROM public.career_atom_links),
      'job_leads', (SELECT count(*) FROM public.job_leads),
      'professional_results', (SELECT count(*) FROM public.professional_results),
      'documents', (SELECT count(*) FROM public.documents)
    ) INTO after_counts;

    v := v || jsonb_build_object('n','produktdata: før/etter-tellinger identiske','p', before_counts = after_counts,
                                 'd','før='||before_counts::text||' etter='||after_counts::text);

    RAISE EXCEPTION 'CANARY_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'CANARY_ROLLBACK' THEN
      v := v || jsonb_build_object('n','canary avbrutt med uventet feil','p',false,'d',SQLERRM);
    END IF;
  END;

  PERFORM set_config('request.jwt.claims', NULL, true);

  RETURN QUERY
  SELECT e->>'n', (e->>'p')::boolean, e->>'d'
  FROM jsonb_array_elements(v) AS e;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.linkedin_promotion_phase4_canary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.linkedin_promotion_phase4_canary() TO service_role;

DROP TABLE IF EXISTS public.canary_run_results;
CREATE TABLE public.canary_run_results AS
SELECT * FROM public.linkedin_promotion_phase4_canary();
ALTER TABLE public.canary_run_results ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.canary_run_results TO service_role;