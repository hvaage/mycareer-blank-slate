
CREATE OR REPLACE FUNCTION public.careerjet_canonicalize_thread(
  p_run_id        uuid,
  p_fencing_token bigint,
  p_thread_id     uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_thread             public.careerjet_source_threads%ROWTYPE;
  v_keeper             public.source_postings%ROWTYPE;
  v_canonical_id       uuid;
  v_canonical          public.canonical_opportunities%ROWTYPE;
  v_keeper_title       text;
  v_keeper_company     text;
  v_keeper_location    text;
  v_keeper_url         text;
  v_canonical_created  boolean := false;
  v_keeper_link_created boolean := false;
  v_link_role          text := NULL;
  v_link_id            uuid := NULL;
  v_already_linked     boolean := false;
  v_display_updated    boolean := false;
  v_new_title          text;
  v_new_company        text;
  v_new_location       text;
  v_lifecycle          jsonb;
  v_live_until_changed boolean := false;
  v_audit_written      boolean := false;
  v_before_jsonb       jsonb;
  v_after_jsonb        jsonb;
BEGIN
  PERFORM public._careerjet_assert_lease('careerjet_global', p_run_id, p_fencing_token);

  SELECT * INTO v_thread FROM public.careerjet_source_threads WHERE id = p_thread_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'thread_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_thread.state <> 'active' THEN
    RAISE EXCEPTION 'thread_state_not_active: %', v_thread.state USING ERRCODE = 'P0001';
  END IF;
  IF v_thread.keeper_source_posting_id IS NULL THEN
    RAISE EXCEPTION 'thread_missing_keeper' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_keeper FROM public.source_postings
    WHERE id = v_thread.keeper_source_posting_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'keeper_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_keeper.source <> 'careerjet' THEN
    RAISE EXCEPTION 'keeper_wrong_source: %', v_keeper.source USING ERRCODE = 'P0001';
  END IF;
  IF v_keeper.identity_thread_id IS DISTINCT FROM v_thread.id THEN
    RAISE EXCEPTION 'keeper_thread_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF v_keeper.identity_role IS DISTINCT FROM 'keeper' THEN
    RAISE EXCEPTION 'keeper_role_not_keeper: %', COALESCE(v_keeper.identity_role,'<null>') USING ERRCODE = 'P0001';
  END IF;
  IF v_keeper.identity_superseded_by_source_posting_id IS NOT NULL THEN
    RAISE EXCEPTION 'keeper_is_superseded' USING ERRCODE = 'P0001';
  END IF;
  IF v_keeper.identity_fingerprint IS DISTINCT FROM v_thread.identity_fingerprint
     OR v_keeper.identity_fp_version IS DISTINCT FROM v_thread.fp_version THEN
    RAISE EXCEPTION 'keeper_fingerprint_mismatch' USING ERRCODE = 'P0001';
  END IF;

  v_keeper_title    := NULLIF(btrim(v_keeper.title), '');
  v_keeper_company  := NULLIF(btrim(v_keeper.company), '');
  v_keeper_location := NULLIF(btrim(v_keeper.location), '');
  v_keeper_url      := COALESCE(NULLIF(btrim(v_keeper.display_url), ''),
                                NULLIF(btrim(v_keeper.raw_url), ''),
                                '');

  INSERT INTO public.canonical_opportunities (
    identity_fingerprint, display_title, display_company, display_location,
    display_url, primary_source
  ) VALUES (
    v_thread.identity_fingerprint,
    v_keeper_title, v_keeper_company, v_keeper_location,
    CASE WHEN v_keeper_url = '' THEN 'about:blank' ELSE v_keeper_url END,
    'careerjet'
  )
  ON CONFLICT (identity_fingerprint) DO NOTHING
  RETURNING id INTO v_canonical_id;

  IF v_canonical_id IS NOT NULL THEN
    v_canonical_created := true;
  ELSE
    SELECT id INTO v_canonical_id FROM public.canonical_opportunities
      WHERE identity_fingerprint = v_thread.identity_fingerprint;
    IF v_canonical_id IS NULL THEN
      RAISE EXCEPTION 'canonical_upsert_race_unresolved' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT * INTO v_canonical FROM public.canonical_opportunities
    WHERE id = v_canonical_id FOR UPDATE;

  IF NOT v_canonical_created THEN
    v_new_title := CASE
      WHEN NULLIF(btrim(v_canonical.display_title), '') IS NULL AND v_keeper_title IS NOT NULL THEN v_keeper_title
      ELSE v_canonical.display_title
    END;
    v_new_company := CASE
      WHEN NULLIF(btrim(v_canonical.display_company), '') IS NULL AND v_keeper_company IS NOT NULL THEN v_keeper_company
      ELSE v_canonical.display_company
    END;
    v_new_location := CASE
      WHEN NULLIF(btrim(v_canonical.display_location), '') IS NULL AND v_keeper_location IS NOT NULL THEN v_keeper_location
      ELSE v_canonical.display_location
    END;
    IF v_new_title    IS DISTINCT FROM v_canonical.display_title
       OR v_new_company  IS DISTINCT FROM v_canonical.display_company
       OR v_new_location IS DISTINCT FROM v_canonical.display_location THEN
      UPDATE public.canonical_opportunities
         SET display_title = v_new_title, display_company = v_new_company,
             display_location = v_new_location, updated_at = now()
       WHERE id = v_canonical_id;
      v_display_updated := true;
    END IF;
  END IF;

  SELECT id, link_role INTO v_link_id, v_link_role
    FROM public.opportunity_source_links
   WHERE canonical_opportunity_id = v_canonical_id
     AND source_posting_id = v_keeper.id;

  IF v_link_id IS NOT NULL THEN
    v_already_linked := true;
  ELSE
    INSERT INTO public.opportunity_source_links (
      canonical_opportunity_id, source_posting_id, link_role, merge_reason
    ) VALUES (v_canonical_id, v_keeper.id, 'primary', 'careerjet_keeper')
    ON CONFLICT DO NOTHING
    RETURNING id, link_role INTO v_link_id, v_link_role;

    IF v_link_id IS NULL THEN
      SELECT id, link_role INTO v_link_id, v_link_role
        FROM public.opportunity_source_links
       WHERE canonical_opportunity_id = v_canonical_id
         AND source_posting_id = v_keeper.id;
      IF v_link_id IS NOT NULL THEN
        v_already_linked := true;
      ELSE
        INSERT INTO public.opportunity_source_links (
          canonical_opportunity_id, source_posting_id, link_role, merge_reason
        ) VALUES (v_canonical_id, v_keeper.id, 'variant', 'careerjet_keeper')
        ON CONFLICT DO NOTHING
        RETURNING id, link_role INTO v_link_id, v_link_role;

        IF v_link_id IS NULL THEN
          SELECT id, link_role INTO v_link_id, v_link_role
            FROM public.opportunity_source_links
           WHERE canonical_opportunity_id = v_canonical_id
             AND source_posting_id = v_keeper.id;
          IF v_link_id IS NULL THEN
            RAISE EXCEPTION 'link_insert_race_unresolved' USING ERRCODE = 'P0001';
          END IF;
          v_already_linked := true;
        ELSE
          v_keeper_link_created := true;
        END IF;
      END IF;
    ELSE
      v_keeper_link_created := true;
    END IF;
  END IF;

  v_lifecycle := public._careerjet_canonical_recompute_live_until(v_canonical_id);
  v_live_until_changed := COALESCE((v_lifecycle->>'changed')::boolean, false);

  IF v_canonical_created OR v_keeper_link_created OR v_display_updated OR v_live_until_changed THEN
    v_before_jsonb := jsonb_build_object(
      'thread_id', v_thread.id,
      'keeper_source_posting_id', v_keeper.id,
      'canonical_existed', NOT v_canonical_created,
      'display_title', v_canonical.display_title,
      'display_company', v_canonical.display_company,
      'display_location', v_canonical.display_location,
      'live_until', v_canonical.live_until
    );
    v_after_jsonb := jsonb_build_object(
      'canonical_id', v_canonical_id,
      'canonical_created', v_canonical_created,
      'keeper_link_created', v_keeper_link_created,
      'link_id', v_link_id,
      'link_role', v_link_role,
      'already_linked', v_already_linked,
      'display_updated', v_display_updated,
      'live_until_changed', v_live_until_changed,
      'lifecycle', v_lifecycle
    );
    INSERT INTO public.careerjet_identity_audit (
      action, thread_id, source_posting_id, run_id, fencing_token,
      before_jsonb, after_jsonb
    ) VALUES (
      'canonicalize', v_thread.id, v_keeper.id, p_run_id, p_fencing_token,
      v_before_jsonb, v_after_jsonb
    );
    v_audit_written := true;
  END IF;

  RETURN jsonb_build_object(
    'canonical_id', v_canonical_id,
    'canonical_created', v_canonical_created,
    'keeper_link_created', v_keeper_link_created,
    'link_id', v_link_id,
    'link_role', v_link_role,
    'already_linked', v_already_linked,
    'display_updated', v_display_updated,
    'live_until_changed', v_live_until_changed,
    'lifecycle', v_lifecycle,
    'audit_written', v_audit_written,
    'fencing_token_valid', true,
    'action', 'canonicalize'
  );
END
$func$;

REVOKE ALL ON FUNCTION public.careerjet_canonicalize_thread(uuid, bigint, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.careerjet_canonicalize_thread(uuid, bigint, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.careerjet_canonicalize_thread(uuid, bigint, uuid) TO service_role;
