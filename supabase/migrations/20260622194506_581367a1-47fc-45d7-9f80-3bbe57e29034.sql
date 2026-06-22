-- Rev. 5: resolver-wiring of canonicalize into careerjet_resolve_listing.
-- Preserve signature, return type, owner, SECURITY DEFINER, search_path, volatility, comment.

DO $pre$
DECLARE
  v_args text; v_ret text; v_secdef boolean; v_vol "char"; v_sp text[]; v_owner oid;
BEGIN
  SELECT pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid),
         p.prosecdef, p.provolatile, p.proconfig, p.proowner
    INTO v_args, v_ret, v_secdef, v_vol, v_sp, v_owner
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='careerjet_resolve_listing';
  PERFORM set_config('rev5.args', v_args, false);
  PERFORM set_config('rev5.ret',  v_ret,  false);
  PERFORM set_config('rev5.secdef', v_secdef::text, false);
  PERFORM set_config('rev5.vol', v_vol::text, false);
  PERFORM set_config('rev5.sp', array_to_string(coalesce(v_sp,'{}'::text[]),'|'), false);
  PERFORM set_config('rev5.owner', v_owner::text, false);
END $pre$;

CREATE OR REPLACE FUNCTION public.careerjet_resolve_listing(
  p_run_id uuid, p_fencing_token bigint, p_fp_version smallint,
  p_identity_fingerprint text, p_source_posting_in jsonb,
  p_observation_aliases jsonb DEFAULT '[]'::jsonb,
  p_observation_terms jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_thread     public.careerjet_source_threads%ROWTYPE;
  v_keeper     public.source_postings%ROWTYPE;
  v_thread_key text; v_new_thread_id uuid; v_new_post_id uuid;
  v_mt text; v_mc text; v_ml text; v_md text; v_ms text; v_me jsonb;
  v_it text; v_ic text; v_il text; v_id text; v_is text; v_ie jsonb;
  v_hash text; v_was_changed boolean; v_classification text;
  v_obs_id uuid; v_alias_rows integer := 0; v_term_rows integer := 0;
  v_review_id uuid;
  v_canonicalization jsonb;
BEGIN
  PERFORM public._careerjet_assert_lease('careerjet_global', p_run_id, p_fencing_token);

  IF p_identity_fingerprint IS NULL OR length(btrim(p_identity_fingerprint))=0 THEN
    SELECT review_id INTO v_review_id FROM public.careerjet_identity_review
     WHERE reason='missing_fingerprint' AND status='open'
       AND identity_fingerprint IS NULL AND thread_id IS NULL LIMIT 1;
    IF v_review_id IS NULL THEN
      INSERT INTO public.careerjet_identity_review (reason, status, evidence)
        VALUES ('missing_fingerprint','open', jsonb_build_object('first_run_id', p_run_id))
        RETURNING review_id INTO v_review_id;
    END IF;
    INSERT INTO public.careerjet_identity_review_observations
      (review_id, sync_run_id, idempotency_key, raw_url, raw_payload)
    VALUES (v_review_id, p_run_id,
      coalesce(p_source_posting_in->>'raw_url_hash',
               encode(extensions.digest(p_run_id::text||':'||coalesce(p_source_posting_in->>'raw_url',''),'sha256'),'hex')),
      p_source_posting_in->>'raw_url', p_source_posting_in)
    ON CONFLICT (review_id, idempotency_key) DO NOTHING;
    RETURN jsonb_build_object('action','review','review_id',v_review_id,'fencing_token_valid',true);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_fp_version::text||':'||p_identity_fingerprint, 0));

  v_thread_key := public._careerjet_thread_key(p_fp_version, p_identity_fingerprint, 1);

  SELECT * INTO v_thread FROM public.careerjet_source_threads
   WHERE identity_fingerprint=p_identity_fingerprint AND fp_version=p_fp_version AND state='active' FOR UPDATE;

  v_it := p_source_posting_in->>'title';
  v_ic := p_source_posting_in->>'company';
  v_il := p_source_posting_in->>'location';
  v_id := p_source_posting_in->>'description';
  v_is := p_source_posting_in->>'site';
  v_ie := coalesce(p_source_posting_in->'employment','{}'::jsonb);

  IF v_thread.id IS NULL THEN
    v_new_thread_id := gen_random_uuid();
    v_new_post_id   := gen_random_uuid();

    INSERT INTO public.source_postings (
      id, source, source_external_id, raw_url, display_url,
      title, company, location, description_excerpt, raw_payload,
      identity_fingerprint, published_at, posting_status, last_seen_at,
      identity_role, identity_fp_version, identity_resolved_at
    ) VALUES (
      v_new_post_id, 'careerjet', v_thread_key,
      coalesce(p_source_posting_in->>'raw_url',''),
      coalesce(p_source_posting_in->>'display_url', p_source_posting_in->>'raw_url',''),
      v_it, v_ic, v_il, v_id, p_source_posting_in, p_identity_fingerprint,
      NULLIF(p_source_posting_in->>'published_at','')::timestamptz, 'active', now(),
      'keeper', p_fp_version, now()
    );

    v_hash := public._careerjet_stable_hash_v1(v_it, v_ic, v_il, v_id, v_is, v_ie);

    INSERT INTO public.careerjet_source_threads (
      id, identity_fingerprint, fp_version, generation, thread_key,
      keeper_source_posting_id, stable_content_hash, stable_content_hash_version,
      first_seen_run_id, last_seen_run_id, last_seen_at, state
    ) VALUES (
      v_new_thread_id, p_identity_fingerprint, p_fp_version, 1, v_thread_key,
      v_new_post_id, v_hash, 1, p_run_id, p_run_id, now(), 'active'
    );

    UPDATE public.source_postings SET identity_thread_id = v_new_thread_id WHERE id = v_new_post_id;

    SELECT * INTO v_thread FROM public.careerjet_source_threads WHERE id=v_new_thread_id;
    v_was_changed := true; v_classification := 'first_sight';

    INSERT INTO public.careerjet_identity_audit
      (action, thread_id, source_posting_id, run_id, fencing_token, after_jsonb)
    VALUES ('first_sight', v_new_thread_id, v_new_post_id, p_run_id, p_fencing_token,
            jsonb_build_object('thread_key', v_thread_key, 'hash', v_hash));
  ELSE
    SELECT * INTO v_keeper FROM public.source_postings WHERE id=v_thread.keeper_source_posting_id FOR UPDATE;

    v_mt := CASE WHEN length(coalesce(v_it,'')) > length(coalesce(v_keeper.title,''))
                 THEN v_it ELSE coalesce(v_keeper.title, v_it) END;
    v_mc := CASE WHEN length(coalesce(v_ic,'')) > length(coalesce(v_keeper.company,''))
                 THEN v_ic ELSE coalesce(v_keeper.company, v_ic) END;
    v_ml := CASE WHEN length(coalesce(v_il,'')) > length(coalesce(v_keeper.location,''))
                 THEN v_il ELSE coalesce(v_keeper.location, v_il) END;
    v_md := CASE WHEN length(coalesce(v_id,'')) > length(coalesce(v_keeper.description_excerpt,''))
                 THEN v_id ELSE coalesce(v_keeper.description_excerpt, v_id) END;
    v_ms := coalesce(v_is, v_keeper.raw_payload->>'site');
    v_me := coalesce(v_ie, v_keeper.raw_payload->'employment', '{}'::jsonb);

    v_hash := public._careerjet_stable_hash_v1(v_mt, v_mc, v_ml, v_md, v_ms, v_me);
    v_was_changed := (v_hash IS DISTINCT FROM v_thread.stable_content_hash);
    v_classification := CASE WHEN v_was_changed THEN 're_seen_changed' ELSE 're_seen_noop' END;

    IF v_was_changed THEN
      UPDATE public.source_postings SET
        title=v_mt, company=v_mc, location=v_ml, description_excerpt=v_md,
        raw_payload = coalesce(raw_payload,'{}'::jsonb) ||
                      jsonb_build_object('site', v_ms, 'employment', v_me),
        last_seen_at = now(), updated_at = now()
       WHERE id = v_keeper.id;
      UPDATE public.careerjet_source_threads SET
        stable_content_hash=v_hash, last_seen_run_id=p_run_id, last_seen_at=now(), updated_at=now()
       WHERE id=v_thread.id;
      INSERT INTO public.careerjet_identity_audit
        (action, thread_id, source_posting_id, run_id, fencing_token, before_jsonb, after_jsonb)
      VALUES ('keeper_merge', v_thread.id, v_keeper.id, p_run_id, p_fencing_token,
              jsonb_build_object('hash', v_thread.stable_content_hash),
              jsonb_build_object('hash', v_hash));
    ELSE
      UPDATE public.source_postings SET last_seen_at=now() WHERE id=v_keeper.id;
      UPDATE public.careerjet_source_threads SET
        last_seen_run_id=p_run_id, last_seen_at=now(), updated_at=now()
       WHERE id=v_thread.id;
    END IF;
  END IF;

  INSERT INTO public.careerjet_source_observations
    (thread_id, sync_run_id, stable_content_hash, was_changed, classification)
  VALUES (v_thread.id, p_run_id, v_hash, v_was_changed, v_classification)
  ON CONFLICT (thread_id, sync_run_id) DO NOTHING
  RETURNING id INTO v_obs_id;

  IF v_obs_id IS NULL THEN
    SELECT id INTO v_obs_id FROM public.careerjet_source_observations
     WHERE thread_id=v_thread.id AND sync_run_id=p_run_id;
  END IF;

  IF jsonb_typeof(p_observation_aliases)='array' THEN
    WITH ins AS (
      INSERT INTO public.careerjet_observation_aliases (observation_id, raw_url_hash, raw_url_norm, raw_url_sample)
      SELECT v_obs_id, a->>'raw_url_hash', coalesce(a->>'raw_url_norm',''), coalesce(a->>'raw_url_sample','')
        FROM jsonb_array_elements(p_observation_aliases) a WHERE a->>'raw_url_hash' IS NOT NULL
      ON CONFLICT DO NOTHING RETURNING 1
    ) SELECT count(*) INTO v_alias_rows FROM ins;
  END IF;
  IF jsonb_typeof(p_observation_terms)='array' THEN
    WITH ins AS (
      INSERT INTO public.careerjet_observation_terms (observation_id, cursor_term, rank_in_term)
      SELECT v_obs_id, t->>'cursor_term', NULLIF(t->>'rank_in_term','')::integer
        FROM jsonb_array_elements(p_observation_terms) t WHERE t->>'cursor_term' IS NOT NULL
      ON CONFLICT DO NOTHING RETURNING 1
    ) SELECT count(*) INTO v_term_rows FROM ins;
  END IF;

  IF v_alias_rows>0 OR v_term_rows>0 THEN
    UPDATE public.careerjet_source_observations
       SET alias_count = alias_count + v_alias_rows, term_count = term_count + v_term_rows
     WHERE id = v_obs_id;
  END IF;

  -- Rev. 5 S1: single canonicalize-call for resolved actions, same RPC txn,
  -- same run_id/fencing_token. Errors propagate and roll back the whole RPC.
  IF v_classification IN ('first_sight','re_seen_changed','re_seen_noop') THEN
    SELECT public.careerjet_canonicalize_thread(p_run_id, p_fencing_token, v_thread.id)
      INTO v_canonicalization;
  ELSE
    RAISE EXCEPTION 'unexpected_resolver_action: %', v_classification USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'action', v_classification, 'thread_id', v_thread.id, 'observation_id', v_obs_id,
    'keeper_source_posting_id', v_thread.keeper_source_posting_id,
    'fencing_token_valid', true,
    'canonicalization', v_canonicalization);
END $function$;

-- Post-checks: signature, return type, owner, security, search_path, volatility unchanged.
DO $post$
DECLARE
  v_args text; v_ret text; v_secdef boolean; v_vol "char"; v_sp text[]; v_owner oid;
BEGIN
  SELECT pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid),
         p.prosecdef, p.provolatile, p.proconfig, p.proowner
    INTO v_args, v_ret, v_secdef, v_vol, v_sp, v_owner
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='careerjet_resolve_listing';
  IF v_args   <> current_setting('rev5.args')   THEN RAISE EXCEPTION 'signature drift: % vs %', v_args, current_setting('rev5.args'); END IF;
  IF v_ret    <> current_setting('rev5.ret')    THEN RAISE EXCEPTION 'return-type drift: % vs %', v_ret, current_setting('rev5.ret'); END IF;
  IF v_secdef::text <> current_setting('rev5.secdef') THEN RAISE EXCEPTION 'security-definer drift'; END IF;
  IF v_vol::text    <> current_setting('rev5.vol')    THEN RAISE EXCEPTION 'volatility drift'; END IF;
  IF array_to_string(coalesce(v_sp,'{}'::text[]),'|') <> current_setting('rev5.sp') THEN
    RAISE EXCEPTION 'search_path drift: % vs %', v_sp, current_setting('rev5.sp');
  END IF;
  IF v_owner::text <> current_setting('rev5.owner') THEN RAISE EXCEPTION 'owner drift'; END IF;
END $post$;