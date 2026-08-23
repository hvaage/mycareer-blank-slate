-- ============================================================
-- Fase 5H — kontrollert selskapsidentitetsavstemming
-- ============================================================

-- Normalisert selskapsnavn: immutabel, brukt både i kandidatsøk og indeks.
CREATE OR REPLACE FUNCTION public.network_company_norm_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    btrim(
      regexp_replace(
        regexp_replace(
          lower(coalesce(p_name, '')),
          '\s+(as|asa|a/s|ans|da|ba|sa|nuf)\s*$', '', 'g'
        ),
        '[^a-z0-9æøå ]+', ' ', 'g'
      )
    ),
  '');
$$;

CREATE INDEX IF NOT EXISTS idx_enheter_norm_name
  ON reg.enheter (public.network_company_norm_name(navn))
  WHERE COALESCE(slettet, false) = false;

-- ------------------------------------------------------------
-- Brukerscopet koblingslag
-- ------------------------------------------------------------
CREATE TABLE public.network_company_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_system text NOT NULL,
  source_record_id text NOT NULL,
  source_identity_key text NOT NULL,
  observed_name text NOT NULL,
  normalized_name text NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  orgnr text,
  match_method text,
  matcher_version text NOT NULL DEFAULT 'company_identity_v1',
  confidence numeric,
  state text NOT NULL,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  confirmed_at timestamptz,
  rejected_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT network_company_reconciliation_state_chk CHECK (
    state IN ('suggested_exact','suggested_possible','not_found','foreign_unknown','confirmed','rejected','not_applicable')
  ),
  CONSTRAINT network_company_reconciliation_method_chk CHECK (
    match_method IS NULL OR match_method IN ('source_orgnr','name_exact','name_possible','manual_search')
  ),
  CONSTRAINT network_company_reconciliation_confirmed_chk CHECK (
    state <> 'confirmed' OR (company_id IS NOT NULL AND orgnr IS NOT NULL AND match_method IS NOT NULL)
  )
);

GRANT SELECT ON public.network_company_reconciliation TO authenticated;
GRANT ALL ON public.network_company_reconciliation TO service_role;

ALTER TABLE public.network_company_reconciliation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own company reconciliation"
  ON public.network_company_reconciliation
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE UNIQUE INDEX network_company_reconciliation_active_uniq
  ON public.network_company_reconciliation (user_id, source_identity_key)
  WHERE superseded_at IS NULL;

CREATE INDEX network_company_reconciliation_user_state_idx
  ON public.network_company_reconciliation (user_id, state)
  WHERE superseded_at IS NULL;

CREATE INDEX network_company_reconciliation_norm_idx
  ON public.network_company_reconciliation (user_id, normalized_name)
  WHERE superseded_at IS NULL;

-- ------------------------------------------------------------
-- Globalt, proveniensbevarende koblingslag for autoritative kilder
-- ------------------------------------------------------------
CREATE TABLE public.source_company_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system text NOT NULL,
  source_record_id text NOT NULL,
  source_identity_key text NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  orgnr text NOT NULL,
  resolution_method text NOT NULL,
  source_observed_at timestamptz,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution_version text NOT NULL DEFAULT 'source_company_resolution_v1',
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_company_resolutions_method_chk CHECK (
    resolution_method IN ('source_orgnr','register_authoritative','internal_quality_assured')
  ),
  CONSTRAINT source_company_resolutions_orgnr_chk CHECK (orgnr ~ '^[0-9]{9}$')
);

-- Ingen tilgang for anon eller authenticated: laget eksponeres kun via serverfunksjoner.
GRANT ALL ON public.source_company_resolutions TO service_role;

ALTER TABLE public.source_company_resolutions ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX source_company_resolutions_active_uniq
  ON public.source_company_resolutions (source_system, source_record_id)
  WHERE superseded_at IS NULL;

CREATE INDEX source_company_resolutions_orgnr_idx
  ON public.source_company_resolutions (orgnr)
  WHERE superseded_at IS NULL;

-- ------------------------------------------------------------
-- Skann: bygg kandidatforslag for brukerens observerte selskapsnavn
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.network_company_reconciliation_scan(p_limit integer DEFAULT 300)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 300), 1), 1000);
  v_obs record;
  v_nname text;
  v_cands jsonb;
  v_count integer;
  v_state text;
  v_conf numeric;
  v_processed integer := 0;
  v_remaining integer := 0;
  v_global record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Ikke innlogget';
  END IF;

  FOR v_obs IN
    WITH observations AS (
      SELECT 'network_contact_company_relation'::text AS source_system,
             r.id::text AS source_record_id,
             COALESCE(NULLIF(btrim(r.company_name_observed), ''), NULLIF(btrim(r.company_name_canonical), '')) AS observed_name
      FROM public.network_contact_company_relations r
      WHERE r.user_id = v_user
        AND r.company_id IS NULL
      UNION ALL
      SELECT 'user_opportunity'::text,
             o.id::text,
             NULLIF(btrim(o.card_company), '')
      FROM public.user_opportunities o
      WHERE o.user_id = v_user
    )
    SELECT o.source_system,
           o.source_record_id,
           o.observed_name,
           o.source_system || ':' || o.source_record_id AS source_identity_key
    FROM observations o
    WHERE o.observed_name IS NOT NULL
      AND public.network_company_norm_name(o.observed_name) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.network_company_reconciliation x
        WHERE x.user_id = v_user
          AND x.superseded_at IS NULL
          AND x.source_identity_key = o.source_system || ':' || o.source_record_id
      )
    ORDER BY o.observed_name
    LIMIT v_limit
  LOOP
    v_nname := public.network_company_norm_name(v_obs.observed_name);

    -- 1) Global, autoritativ kobling for nøyaktig denne kilden vinner alltid.
    SELECT * INTO v_global
    FROM public.source_company_resolutions g
    WHERE g.superseded_at IS NULL
      AND g.source_system = v_obs.source_system
      AND g.source_record_id = v_obs.source_record_id
    LIMIT 1;

    IF FOUND THEN
      INSERT INTO public.network_company_reconciliation (
        user_id, source_system, source_record_id, source_identity_key,
        observed_name, normalized_name, company_id, orgnr, match_method,
        confidence, state, candidates, confirmed_at
      ) VALUES (
        v_user, v_obs.source_system, v_obs.source_record_id, v_obs.source_identity_key,
        v_obs.observed_name, v_nname, v_global.company_id, v_global.orgnr, 'source_orgnr',
        1.0, 'confirmed', '[]'::jsonb, now()
      )
      ON CONFLICT DO NOTHING;

      INSERT INTO public.user_company_relationships (user_id, company_id, company_name_user, relationship_kind, source_system)
      VALUES (v_user, v_global.company_id, v_obs.observed_name, 'nettverk', v_obs.source_system)
      ON CONFLICT (user_id, company_id) DO NOTHING;

      v_processed := v_processed + 1;
      CONTINUE;
    END IF;

    -- 2) Eksakt normalisert navnetreff i registerspeilet.
    SELECT jsonb_agg(c ORDER BY c->>'navn'), count(*)
      INTO v_cands, v_count
    FROM (
      SELECT jsonb_build_object(
               'orgnr', e.organisasjonsnummer,
               'navn', e.navn,
               'organisasjonsform', e.organisasjonsform_beskrivelse,
               'kommune', e.forretningsadresse_kommune,
               'antall_ansatte', e.antall_ansatte,
               'kilde', 'name_exact'
             ) AS c
      FROM reg.enheter e
      WHERE COALESCE(e.slettet, false) = false
        AND public.network_company_norm_name(e.navn) = v_nname
      LIMIT 20
    ) s;

    IF COALESCE(v_count, 0) = 1 THEN
      v_state := 'suggested_exact';
      v_conf := 0.92;
    ELSIF COALESCE(v_count, 0) > 1 THEN
      v_state := 'suggested_possible';
      v_conf := 0.6;
    ELSE
      -- 3) Nærliggende navn (trigram) gir kun mulige kandidater.
      SELECT jsonb_agg(c ORDER BY (c->>'score')::numeric DESC), count(*)
        INTO v_cands, v_count
      FROM (
        SELECT jsonb_build_object(
                 'orgnr', e.organisasjonsnummer,
                 'navn', e.navn,
                 'organisasjonsform', e.organisasjonsform_beskrivelse,
                 'kommune', e.forretningsadresse_kommune,
                 'antall_ansatte', e.antall_ansatte,
                 'score', round(similarity(e.navn, v_obs.observed_name)::numeric, 3),
                 'kilde', 'name_possible'
               ) AS c
        FROM reg.enheter e
        WHERE COALESCE(e.slettet, false) = false
          AND e.navn % v_obs.observed_name
          AND similarity(e.navn, v_obs.observed_name) >= 0.55
        ORDER BY similarity(e.navn, v_obs.observed_name) DESC
        LIMIT 10
      ) s;

      IF COALESCE(v_count, 0) > 0 THEN
        v_state := 'suggested_possible';
        v_conf := 0.4;
      ELSIF v_obs.observed_name ~* '(\m(inc|llc|ltd|limited|gmbh|plc|bv|b\.v\.|sarl|oy|ab|aps|a/s|corp|corporation)\M)' THEN
        v_state := 'foreign_unknown';
        v_conf := NULL;
        v_cands := '[]'::jsonb;
      ELSE
        v_state := 'not_found';
        v_conf := NULL;
        v_cands := '[]'::jsonb;
      END IF;
    END IF;

    INSERT INTO public.network_company_reconciliation (
      user_id, source_system, source_record_id, source_identity_key,
      observed_name, normalized_name, state, confidence, candidates
    ) VALUES (
      v_user, v_obs.source_system, v_obs.source_record_id, v_obs.source_identity_key,
      v_obs.observed_name, v_nname, v_state, v_conf, COALESCE(v_cands, '[]'::jsonb)
    )
    ON CONFLICT DO NOTHING;

    v_processed := v_processed + 1;
  END LOOP;

  SELECT count(*) INTO v_remaining
  FROM (
    SELECT r.id::text AS rid, 'network_contact_company_relation'::text AS ss,
           COALESCE(NULLIF(btrim(r.company_name_observed), ''), NULLIF(btrim(r.company_name_canonical), '')) AS nm
    FROM public.network_contact_company_relations r
    WHERE r.user_id = v_user AND r.company_id IS NULL
    UNION ALL
    SELECT o.id::text, 'user_opportunity'::text, NULLIF(btrim(o.card_company), '')
    FROM public.user_opportunities o
    WHERE o.user_id = v_user
  ) o
  WHERE o.nm IS NOT NULL
    AND public.network_company_norm_name(o.nm) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.network_company_reconciliation x
      WHERE x.user_id = v_user AND x.superseded_at IS NULL
        AND x.source_identity_key = o.ss || ':' || o.rid
    );

  RETURN jsonb_build_object('processed', v_processed, 'remaining', v_remaining);
END;
$$;

REVOKE ALL ON FUNCTION public.network_company_reconciliation_scan(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.network_company_reconciliation_scan(integer) TO authenticated;

-- ------------------------------------------------------------
-- Bekreft kobling — servervalidert kandidat
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.network_company_reconciliation_confirm(
  p_reconciliation_id uuid,
  p_orgnr text,
  p_from_register_search boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.network_company_reconciliation%ROWTYPE;
  v_orgnr text := regexp_replace(COALESCE(p_orgnr, ''), '[^0-9]', '', 'g');
  v_in_candidates boolean;
  v_company_id uuid;
  v_method text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Ikke innlogget';
  END IF;

  SELECT * INTO v_row
  FROM public.network_company_reconciliation
  WHERE id = p_reconciliation_id AND user_id = v_user AND superseded_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_row.state = 'confirmed' THEN
    RETURN jsonb_build_object('status', 'already_confirmed', 'company_id', v_row.company_id, 'orgnr', v_row.orgnr);
  END IF;

  IF v_orgnr !~ '^[0-9]{9}$' THEN
    RETURN jsonb_build_object('status', 'invalid_orgnr');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM reg.enheter e
    WHERE e.organisasjonsnummer = v_orgnr AND COALESCE(e.slettet, false) = false
  ) THEN
    RETURN jsonb_build_object('status', 'not_in_register');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_row.candidates) c
    WHERE c->>'orgnr' = v_orgnr
  ) INTO v_in_candidates;

  IF v_in_candidates THEN
    v_method := CASE WHEN v_row.state = 'suggested_exact' THEN 'name_exact' ELSE 'name_possible' END;
  ELSIF COALESCE(p_from_register_search, false) THEN
    v_method := 'manual_search';
  ELSE
    RETURN jsonb_build_object('status', 'candidate_not_allowed');
  END IF;

  v_company_id := public.ensure_company_for_employer(v_orgnr);
  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('status', 'company_unavailable');
  END IF;

  UPDATE public.network_company_reconciliation
  SET company_id = v_company_id,
      orgnr = v_orgnr,
      match_method = v_method,
      state = 'confirmed',
      confidence = CASE WHEN v_method = 'name_exact' THEN 0.92 ELSE 0.75 END,
      confirmed_at = now(),
      rejected_at = NULL,
      updated_at = now()
  WHERE id = v_row.id;

  INSERT INTO public.user_company_relationships (user_id, company_id, company_name_user, relationship_kind, source_system)
  VALUES (v_user, v_company_id, v_row.observed_name, 'nettverk', v_row.source_system)
  ON CONFLICT (user_id, company_id) DO NOTHING;

  RETURN jsonb_build_object('status', 'confirmed', 'company_id', v_company_id, 'orgnr', v_orgnr, 'match_method', v_method);
END;
$$;

REVOKE ALL ON FUNCTION public.network_company_reconciliation_confirm(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.network_company_reconciliation_confirm(uuid, text, boolean) TO authenticated;

-- ------------------------------------------------------------
-- Avvis / ikke aktuelt / gjenåpne
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.network_company_reconciliation_set_state(
  p_reconciliation_id uuid,
  p_state text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.network_company_reconciliation%ROWTYPE;
  v_next text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Ikke innlogget';
  END IF;

  IF p_state NOT IN ('rejected', 'not_applicable', 'reopen') THEN
    RETURN jsonb_build_object('status', 'invalid_state');
  END IF;

  SELECT * INTO v_row
  FROM public.network_company_reconciliation
  WHERE id = p_reconciliation_id AND user_id = v_user AND superseded_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF p_state = 'reopen' THEN
    v_next := CASE
      WHEN jsonb_array_length(v_row.candidates) = 1 THEN 'suggested_exact'
      WHEN jsonb_array_length(v_row.candidates) > 1 THEN 'suggested_possible'
      ELSE 'not_found'
    END;

    UPDATE public.network_company_reconciliation
    SET state = v_next, rejected_at = NULL, confirmed_at = NULL,
        company_id = NULL, orgnr = NULL, match_method = NULL, updated_at = now()
    WHERE id = v_row.id;

    RETURN jsonb_build_object('status', 'reopened', 'state', v_next);
  END IF;

  UPDATE public.network_company_reconciliation
  SET state = p_state, rejected_at = now(), updated_at = now()
  WHERE id = v_row.id;

  RETURN jsonb_build_object('status', p_state);
END;
$$;

REVOKE ALL ON FUNCTION public.network_company_reconciliation_set_state(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.network_company_reconciliation_set_state(uuid, text) TO authenticated;

-- ------------------------------------------------------------
-- Globalt lag: kun autoritative kilder, kun server (service_role)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.source_company_resolution_upsert(
  p_source_system text,
  p_source_record_id text,
  p_orgnr text,
  p_resolution_method text DEFAULT 'source_orgnr',
  p_provenance jsonb DEFAULT '{}'::jsonb,
  p_source_observed_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orgnr text := regexp_replace(COALESCE(p_orgnr, ''), '[^0-9]', '', 'g');
  v_company_id uuid;
  v_existing public.source_company_resolutions%ROWTYPE;
BEGIN
  IF COALESCE(btrim(p_source_system), '') = '' OR COALESCE(btrim(p_source_record_id), '') = '' THEN
    RETURN jsonb_build_object('status', 'invalid_source');
  END IF;

  IF v_orgnr !~ '^[0-9]{9}$' THEN
    RETURN jsonb_build_object('status', 'invalid_orgnr');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM reg.enheter e
    WHERE e.organisasjonsnummer = v_orgnr AND COALESCE(e.slettet, false) = false
  ) THEN
    RETURN jsonb_build_object('status', 'not_in_register');
  END IF;

  v_company_id := public.ensure_company_for_employer(v_orgnr);
  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('status', 'company_unavailable');
  END IF;

  SELECT * INTO v_existing
  FROM public.source_company_resolutions
  WHERE source_system = p_source_system
    AND source_record_id = p_source_record_id
    AND superseded_at IS NULL;

  IF FOUND THEN
    IF v_existing.orgnr = v_orgnr THEN
      RETURN jsonb_build_object('status', 'unchanged', 'company_id', v_existing.company_id, 'orgnr', v_orgnr);
    END IF;

    UPDATE public.source_company_resolutions
    SET superseded_at = now()
    WHERE id = v_existing.id;
  END IF;

  INSERT INTO public.source_company_resolutions (
    source_system, source_record_id, source_identity_key, company_id, orgnr,
    resolution_method, source_observed_at, provenance
  ) VALUES (
    p_source_system, p_source_record_id, p_source_system || ':' || p_source_record_id,
    v_company_id, v_orgnr, p_resolution_method, p_source_observed_at, COALESCE(p_provenance, '{}'::jsonb)
  );

  RETURN jsonb_build_object('status', 'resolved', 'company_id', v_company_id, 'orgnr', v_orgnr);
END;
$$;

REVOKE ALL ON FUNCTION public.source_company_resolution_upsert(text, text, text, text, jsonb, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.source_company_resolution_upsert(text, text, text, text, jsonb, timestamptz) TO service_role;