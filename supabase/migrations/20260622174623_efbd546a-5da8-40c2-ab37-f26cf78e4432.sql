
-- ============================================================================
-- Step 6 — Canonicalization gate (Careerjet)
-- Adds careerjet_canonicalize_thread + _careerjet_canonical_recompute_live_until.
-- No table changes. Idempotent re-deploy: CREATE OR REPLACE only.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Lock down the helper oracle to service_role only
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.careerjet_canonical_has_visible(uuid)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.careerjet_canonical_has_visible(uuid)
  FROM anon;
REVOKE EXECUTE ON FUNCTION public.careerjet_canonical_has_visible(uuid)
  FROM authenticated;
GRANT EXECUTE ON FUNCTION public.careerjet_canonical_has_visible(uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Internal lifecycle helper (owner-only).
--    Identity-aware: NAV/other sources always qualify; Careerjet qualifies
--    only when visible (identity_role IS DISTINCT FROM 'superseded'
--    AND identity_superseded_by_source_posting_id IS NULL).
--    Idempotent for immediate-expiry case so repeat calls return changed=false.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._careerjet_canonical_recompute_live_until(
  p_canonical uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_old_live   timestamptz;
  v_new_live   timestamptz;
  v_now        timestamptz := statement_timestamp();
  v_qual       int := 0;
  v_active     int := 0;
  v_terminal   int := 0;
  v_max_exp    timestamptz;
BEGIN
  -- Lock the canonical row so concurrent recomputes serialize.
  SELECT live_until INTO v_old_live
    FROM public.canonical_opportunities
   WHERE id = p_canonical
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('changed', false, 'reason', 'canonical_not_found');
  END IF;

  -- Aggregate qualifying sources for this canonical.
  WITH src AS (
    SELECT sp.posting_status, sp.expired_at, sp.source,
           sp.identity_role, sp.identity_superseded_by_source_posting_id
      FROM public.opportunity_source_links osl
      JOIN public.source_postings sp ON sp.id = osl.source_posting_id
     WHERE osl.canonical_opportunity_id = p_canonical
  ),
  qual AS (
    SELECT * FROM src
     WHERE source <> 'careerjet'
        OR public._careerjet_is_visible(identity_role,
                                        identity_superseded_by_source_posting_id)
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE posting_status = 'active'),
    count(*) FILTER (WHERE posting_status IN ('expired','removed')),
    max(expired_at) FILTER (WHERE posting_status IN ('expired','removed'))
  INTO v_qual, v_active, v_terminal, v_max_exp
  FROM qual;

  IF v_qual = 0 THEN
    -- No qualifying sources: expire now, but keep existing past-expiry value
    -- so re-invocation is a no-op.
    IF v_old_live IS NOT NULL AND v_old_live <= v_now THEN
      v_new_live := v_old_live;
    ELSE
      v_new_live := v_now;
    END IF;
  ELSIF v_active > 0 THEN
    v_new_live := NULL;
  ELSIF v_terminal = v_qual THEN
    IF v_max_exp IS NOT NULL THEN
      v_new_live := v_max_exp + interval '7 days';
    ELSIF v_old_live IS NOT NULL AND v_old_live <= v_now THEN
      v_new_live := v_old_live;
    ELSE
      v_new_live := v_now;
    END IF;
  ELSE
    RETURN jsonb_build_object('changed', false,
                              'reason', 'unexpected_status_mix',
                              'qualifying_count', v_qual,
                              'active_count', v_active,
                              'terminal_count', v_terminal);
  END IF;

  IF v_new_live IS DISTINCT FROM v_old_live THEN
    UPDATE public.canonical_opportunities
       SET live_until = v_new_live,
           updated_at = now()
     WHERE id = p_canonical;
    RETURN jsonb_build_object(
      'changed', true,
      'before', v_old_live,
      'after',  v_new_live,
      'qualifying_count', v_qual,
      'active_count', v_active,
      'terminal_count', v_terminal
    );
  END IF;

  RETURN jsonb_build_object(
    'changed', false,
    'live_until', v_old_live,
    'qualifying_count', v_qual,
    'active_count', v_active,
    'terminal_count', v_terminal
  );
END
$func$;

-- Owner-only: never expose to anon/authenticated/service_role.
REVOKE ALL ON FUNCTION public._careerjet_canonical_recompute_live_until(uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public._careerjet_canonical_recompute_live_until(uuid)
  FROM anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Public RPC — full thread/keeper contract under lease.
-- ---------------------------------------------------------------------------
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
  -- 0) Lease + fencing
  PERFORM public._careerjet_assert_lease('careerjet_global', p_run_id, p_fencing_token);

  -- 1) Lock thread
  SELECT * INTO v_thread
    FROM public.careerjet_source_threads
   WHERE id = p_thread_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'thread_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- 2) State must be 'active'
  IF v_thread.state <> 'active' THEN
    RAISE EXCEPTION 'thread_state_not_active: %', v_thread.state USING ERRCODE = 'P0001';
  END IF;
  IF v_thread.keeper_source_posting_id IS NULL THEN
    RAISE EXCEPTION 'thread_missing_keeper' USING ERRCODE = 'P0001';
  END IF;

  -- 3) Lock keeper
  SELECT * INTO v_keeper
    FROM public.source_postings
   WHERE id = v_thread.keeper_source_posting_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'keeper_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- 4–8) Keeper invariants
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

  -- Keeper display values, trimmed and NULL/blank-safe.
  v_keeper_title    := NULLIF(btrim(v_keeper.title), '');
  v_keeper_company  := NULLIF(btrim(v_keeper.company_name), '');
  v_keeper_location := NULLIF(btrim(v_keeper.location), '');
  v_keeper_url      := COALESCE(NULLIF(btrim(v_keeper.display_url), ''),
                                NULLIF(btrim(v_keeper.raw_url), ''),
                                '');

  -- 9) Canonical race-safe upsert on identity_fingerprint.
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
    SELECT id INTO v_canonical_id
      FROM public.canonical_opportunities
     WHERE identity_fingerprint = v_thread.identity_fingerprint;
    IF v_canonical_id IS NULL THEN
      RAISE EXCEPTION 'canonical_upsert_race_unresolved' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Lock the canonical for the rest of the txn.
  SELECT * INTO v_canonical
    FROM public.canonical_opportunities
   WHERE id = v_canonical_id
   FOR UPDATE;

  -- 10) NULL/blank-only display fill (no overwrite of existing data).
  IF NOT v_canonical_created THEN
    v_new_title := CASE
      WHEN NULLIF(btrim(v_canonical.display_title), '') IS NULL
       AND v_keeper_title IS NOT NULL THEN v_keeper_title
      ELSE v_canonical.display_title
    END;
    v_new_company := CASE
      WHEN NULLIF(btrim(v_canonical.display_company), '') IS NULL
       AND v_keeper_company IS NOT NULL THEN v_keeper_company
      ELSE v_canonical.display_company
    END;
    v_new_location := CASE
      WHEN NULLIF(btrim(v_canonical.display_location), '') IS NULL
       AND v_keeper_location IS NOT NULL THEN v_keeper_location
      ELSE v_canonical.display_location
    END;

    IF v_new_title    IS DISTINCT FROM v_canonical.display_title
       OR v_new_company  IS DISTINCT FROM v_canonical.display_company
       OR v_new_location IS DISTINCT FROM v_canonical.display_location THEN
      UPDATE public.canonical_opportunities
         SET display_title    = v_new_title,
             display_company  = v_new_company,
             display_location = v_new_location,
             updated_at = now()
       WHERE id = v_canonical_id;
      v_display_updated := true;
    END IF;
  END IF;

  -- 11) Race-safe primary-then-variant link insert for the keeper.
  --     The keeper-canonical pair has a UNIQUE (canonical, source_posting).
  --     A partial-unique blocks a second primary per canonical.
  --
  -- Already linked? Then nothing to insert.
  SELECT id, link_role INTO v_link_id, v_link_role
    FROM public.opportunity_source_links
   WHERE canonical_opportunity_id = v_canonical_id
     AND source_posting_id = v_keeper.id;

  IF v_link_id IS NOT NULL THEN
    v_already_linked := true;
  ELSE
    -- Try primary first.
    INSERT INTO public.opportunity_source_links (
      canonical_opportunity_id, source_posting_id, link_role, merge_reason
    ) VALUES (
      v_canonical_id, v_keeper.id, 'primary', 'careerjet_keeper'
    )
    ON CONFLICT DO NOTHING
    RETURNING id, link_role INTO v_link_id, v_link_role;

    IF v_link_id IS NULL THEN
      -- Either the keeper-pair was inserted concurrently (UNIQUE pair)
      -- or another primary exists (partial unique). Reselect; if still no
      -- keeper-link, fall back to variant.
      SELECT id, link_role INTO v_link_id, v_link_role
        FROM public.opportunity_source_links
       WHERE canonical_opportunity_id = v_canonical_id
         AND source_posting_id = v_keeper.id;

      IF v_link_id IS NOT NULL THEN
        v_already_linked := true;
      ELSE
        INSERT INTO public.opportunity_source_links (
          canonical_opportunity_id, source_posting_id, link_role, merge_reason
        ) VALUES (
          v_canonical_id, v_keeper.id, 'variant', 'careerjet_keeper'
        )
        ON CONFLICT DO NOTHING
        RETURNING id, link_role INTO v_link_id, v_link_role;

        IF v_link_id IS NULL THEN
          -- Final reselect; raise if still nothing (race unresolved).
          SELECT id, link_role INTO v_link_id, v_link_role
            FROM public.opportunity_source_links
           WHERE canonical_opportunity_id = v_canonical_id
             AND source_posting_id = v_keeper.id;
          IF v_link_id IS NULL THEN
            RAISE EXCEPTION 'link_insert_race_unresolved'
              USING ERRCODE = 'P0001';
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

  -- 12) Lifecycle recompute (identity-aware, idempotent).
  v_lifecycle := public._careerjet_canonical_recompute_live_until(v_canonical_id);
  v_live_until_changed := COALESCE((v_lifecycle->>'changed')::boolean, false);

  -- 13) Audit: one row per call if anything materially changed.
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
    'canonical_id',         v_canonical_id,
    'canonical_created',    v_canonical_created,
    'keeper_link_created',  v_keeper_link_created,
    'link_id',              v_link_id,
    'link_role',            v_link_role,
    'already_linked',       v_already_linked,
    'display_updated',      v_display_updated,
    'live_until_changed',   v_live_until_changed,
    'lifecycle',            v_lifecycle,
    'audit_written',        v_audit_written,
    'fencing_token_valid',  true,
    'action',               'canonicalize'
  );
END
$func$;

REVOKE ALL ON FUNCTION public.careerjet_canonicalize_thread(uuid, bigint, uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.careerjet_canonicalize_thread(uuid, bigint, uuid)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.careerjet_canonicalize_thread(uuid, bigint, uuid)
  TO service_role;

COMMENT ON FUNCTION public.careerjet_canonicalize_thread(uuid, bigint, uuid) IS
  'Step 6 canonicalization gate. Lease+fencing protected. Validates thread (state=active) and keeper (source=careerjet, identity_role=keeper, fingerprint match) under FOR UPDATE locks, then upserts canonical_opportunities (race-safe), inserts the keeper as primary or variant in opportunity_source_links, fills only NULL/blank display fields, recomputes live_until via _careerjet_canonical_recompute_live_until, and writes one careerjet_identity_audit row when something changes.';

COMMENT ON FUNCTION public._careerjet_canonical_recompute_live_until(uuid) IS
  'Step 6 lifecycle helper. Owner-only. Identity-aware qualifying predicate: NAV/other sources always count; Careerjet must satisfy _careerjet_is_visible. Idempotent for already-past expiry.';
