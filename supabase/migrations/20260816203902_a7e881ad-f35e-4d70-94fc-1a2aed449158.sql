-- =====================================================================
-- CV-gjennomgang v4: kanonisk koblingsmodell + fremdrift + privat kontekst
-- =====================================================================

-- ---------------------------------------------------------------- links
CREATE TABLE public.career_atom_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  from_atom_id uuid NOT NULL REFERENCES public.career_atoms(id) ON DELETE RESTRICT,
  to_atom_id uuid NOT NULL REFERENCES public.career_atoms(id) ON DELETE RESTRICT,
  link_type text NOT NULL CHECK (link_type IN ('belegges_av','oppnadd_i','avledet_av')),
  decided_by text NOT NULL DEFAULT 'machine_suggested'
    CHECK (decided_by IN ('machine_suggested','user_confirmed','user_overridden')),
  status text NOT NULL DEFAULT 'foreslatt'
    CHECK (status IN ('foreslatt','aktiv','avvist','trenger_ny_vurdering')),
  confidence text CHECK (confidence IN ('hoy','lav')),
  reasons jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_import_id uuid NOT NULL REFERENCES public.cv_imports(id) ON DELETE RESTRICT,
  source_candidate_id uuid REFERENCES public.cv_parse_candidates(id) ON DELETE RESTRICT,
  supersedes_link_id uuid REFERENCES public.career_atom_links(id) ON DELETE RESTRICT,
  superseded_at timestamptz,
  superseded_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by_user_id uuid
);

CREATE UNIQUE INDEX career_atom_links_unique_live
  ON public.career_atom_links (user_id, from_atom_id, to_atom_id, link_type)
  WHERE superseded_at IS NULL;

-- Ett resultat kan ha maksimalt én aktiv rolleplassering.
CREATE UNIQUE INDEX career_atom_links_one_active_role
  ON public.career_atom_links (user_id, from_atom_id)
  WHERE link_type = 'oppnadd_i' AND status = 'aktiv' AND superseded_at IS NULL;

CREATE UNIQUE INDEX career_atom_links_supersedes_once
  ON public.career_atom_links (supersedes_link_id)
  WHERE supersedes_link_id IS NOT NULL;

CREATE INDEX career_atom_links_from_idx ON public.career_atom_links (from_atom_id, status);
CREATE INDEX career_atom_links_to_idx ON public.career_atom_links (to_atom_id, status);
CREATE INDEX career_atom_links_user_idx ON public.career_atom_links (user_id, review_import_id);

GRANT SELECT ON public.career_atom_links TO authenticated;
GRANT ALL ON public.career_atom_links TO service_role;
ALTER TABLE public.career_atom_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "links_select_own" ON public.career_atom_links
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ------------------------------------------------------ projeksjonstabeller
CREATE TABLE public.career_atom_evidence_projection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  atom_id uuid NOT NULL REFERENCES public.career_atoms(id) ON DELETE RESTRICT,
  referenced_atom_id uuid NOT NULL REFERENCES public.career_atoms(id) ON DELETE RESTRICT,
  link_id uuid NOT NULL REFERENCES public.career_atom_links(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (atom_id, referenced_atom_id)
);
GRANT SELECT ON public.career_atom_evidence_projection TO authenticated;
GRANT ALL ON public.career_atom_evidence_projection TO service_role;
ALTER TABLE public.career_atom_evidence_projection ENABLE ROW LEVEL SECURITY;
CREATE POLICY "evidence_projection_select_own" ON public.career_atom_evidence_projection
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.career_atom_parent_projection (
  atom_id uuid PRIMARY KEY REFERENCES public.career_atoms(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  parent_atom_id uuid NOT NULL REFERENCES public.career_atoms(id) ON DELETE RESTRICT,
  link_id uuid NOT NULL REFERENCES public.career_atom_links(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.career_atom_parent_projection TO authenticated;
GRANT ALL ON public.career_atom_parent_projection TO service_role;
ALTER TABLE public.career_atom_parent_projection ENABLE ROW LEVEL SECURITY;
CREATE POLICY "parent_projection_select_own" ON public.career_atom_parent_projection
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- --------------------------------------------------------- databasevakt
CREATE OR REPLACE FUNCTION public.career_atom_links_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_from public.career_atoms%ROWTYPE;
  v_to public.career_atoms%ROWTYPE;
  v_prev public.career_atom_links%ROWTYPE;
  v_cand public.cv_parse_candidates%ROWTYPE;
  v_imp_user uuid;
  v_depth int := 0;
  v_cursor uuid;
BEGIN
  IF NEW.from_atom_id = NEW.to_atom_id THEN
    RAISE EXCEPTION 'En kobling kan ikke peke til seg selv';
  END IF;

  SELECT * INTO v_from FROM public.career_atoms WHERE id = NEW.from_atom_id;
  SELECT * INTO v_to FROM public.career_atoms WHERE id = NEW.to_atom_id;
  IF v_from.id IS NULL OR v_to.id IS NULL THEN
    RAISE EXCEPTION 'Ukjent element i koblingen';
  END IF;
  IF v_from.user_id <> v_to.user_id OR v_from.user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'Koblinger kan bare gå mellom elementer som tilhører samme bruker';
  END IF;

  SELECT user_id INTO v_imp_user FROM public.cv_imports WHERE id = NEW.review_import_id;
  IF v_imp_user IS NULL OR v_imp_user <> NEW.user_id THEN
    RAISE EXCEPTION 'Gjennomgangskonteksten tilhører ikke brukeren';
  END IF;

  IF NEW.source_candidate_id IS NOT NULL THEN
    SELECT * INTO v_cand FROM public.cv_parse_candidates WHERE id = NEW.source_candidate_id;
    IF v_cand.id IS NULL OR v_cand.user_id <> NEW.user_id THEN
      RAISE EXCEPTION 'Kildekandidaten tilhører ikke brukeren';
    END IF;
    IF v_cand.import_id <> NEW.review_import_id THEN
      RAISE EXCEPTION 'Kildekandidaten hører til en annen import enn gjennomgangskonteksten';
    END IF;
    IF v_cand.status = 'avvist' THEN
      RAISE EXCEPTION 'En avvist kandidat kan ikke være kilde for en kobling';
    END IF;
  END IF;

  -- Typekombinasjoner
  IF NEW.link_type = 'belegges_av' THEN
    IF v_from.atom_class IS DISTINCT FROM 'kompetanse' THEN
      RAISE EXCEPTION 'belegges_av må gå ut fra en kompetanse';
    END IF;
    IF COALESCE(v_to.atom_class, '') NOT IN ('resultat','kvalifikasjon')
       AND v_to.atom_type <> 'role' THEN
      RAISE EXCEPTION 'belegges_av må peke på en rolle, et resultat eller en kvalifikasjon';
    END IF;
  ELSIF NEW.link_type = 'avledet_av' THEN
    IF v_from.atom_class IS DISTINCT FROM 'eksponering' THEN
      RAISE EXCEPTION 'avledet_av må gå ut fra en eksponering';
    END IF;
    IF v_to.atom_type <> 'role' THEN
      RAISE EXCEPTION 'avledet_av må peke på en rolle';
    END IF;
  ELSIF NEW.link_type = 'oppnadd_i' THEN
    IF v_from.atom_class IS DISTINCT FROM 'resultat' THEN
      RAISE EXCEPTION 'oppnadd_i må gå ut fra et resultat';
    END IF;
    IF v_to.atom_type <> 'role' THEN
      RAISE EXCEPTION 'oppnadd_i må peke på en rolle';
    END IF;
  END IF;

  IF NEW.status = 'aktiv' AND (NOT v_from.is_active OR NOT v_to.is_active) THEN
    RAISE EXCEPTION 'En aktiv kobling kan ikke peke på et arkivert element';
  END IF;

  IF NEW.supersedes_link_id IS NOT NULL THEN
    SELECT * INTO v_prev FROM public.career_atom_links WHERE id = NEW.supersedes_link_id;
    IF v_prev.id IS NULL THEN
      RAISE EXCEPTION 'Ukjent kobling i historikken';
    END IF;
    IF v_prev.user_id <> NEW.user_id OR v_prev.link_type <> NEW.link_type
       OR v_prev.from_atom_id <> NEW.from_atom_id THEN
      RAISE EXCEPTION 'En kobling kan bare erstatte en kobling av samme type for samme element';
    END IF;
    IF NEW.supersedes_link_id = NEW.id THEN
      RAISE EXCEPTION 'Sirkulær historikk';
    END IF;
    v_cursor := v_prev.supersedes_link_id;
    WHILE v_cursor IS NOT NULL AND v_depth < 50 LOOP
      IF v_cursor = NEW.id THEN
        RAISE EXCEPTION 'Sirkulær historikk';
      END IF;
      SELECT supersedes_link_id INTO v_cursor FROM public.career_atom_links WHERE id = v_cursor;
      v_depth := v_depth + 1;
    END LOOP;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS NULL THEN
    RAISE EXCEPTION 'En erstattet kobling kan ikke gjenopplives';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER career_atom_links_guard_trg
BEFORE INSERT OR UPDATE ON public.career_atom_links
FOR EACH ROW EXECUTE FUNCTION public.career_atom_links_guard();

-- ----------------------------------------------------- projeksjonsfunksjoner
CREATE OR REPLACE FUNCTION public.career_atom_project_evidence(p_atom_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid;
  v_desired uuid[];
  v_drop uuid[];
BEGIN
  SELECT user_id INTO v_user FROM public.career_atoms WHERE id = p_atom_id;
  IF v_user IS NULL THEN RETURN; END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> v_user THEN
    RAISE EXCEPTION 'Ikke tilgang';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT l.to_atom_id), '{}')
    INTO v_desired
  FROM public.career_atom_links l
  JOIN public.career_atoms t ON t.id = l.to_atom_id
  WHERE l.from_atom_id = p_atom_id
    AND l.link_type IN ('belegges_av','avledet_av')
    AND l.status = 'aktiv'
    AND l.superseded_at IS NULL
    AND t.is_active;

  SELECT COALESCE(array_agg(p.referenced_atom_id), '{}')
    INTO v_drop
  FROM public.career_atom_evidence_projection p
  WHERE p.atom_id = p_atom_id
    AND NOT (p.referenced_atom_id = ANY (v_desired));

  DELETE FROM public.career_atom_evidence_projection p
  WHERE p.atom_id = p_atom_id AND NOT (p.referenced_atom_id = ANY (v_desired));

  INSERT INTO public.career_atom_evidence_projection (user_id, atom_id, referenced_atom_id, link_id)
  SELECT v_user, p_atom_id, l.to_atom_id, min(l.id)
  FROM public.career_atom_links l
  WHERE l.from_atom_id = p_atom_id
    AND l.link_type IN ('belegges_av','avledet_av')
    AND l.status = 'aktiv'
    AND l.superseded_at IS NULL
    AND l.to_atom_id = ANY (v_desired)
  GROUP BY l.to_atom_id
  ON CONFLICT (atom_id, referenced_atom_id) DO NOTHING;

  -- Bevar referanser vi ikke eier; fjern bare de projeksjonen selv eide.
  UPDATE public.career_atoms c
  SET evidence_atom_ids = ARRAY(
        SELECT DISTINCT x FROM unnest(
          ARRAY(
            SELECT unnest(COALESCE(c.evidence_atom_ids, '{}'::uuid[]))
            EXCEPT SELECT unnest(v_drop)
          ) || v_desired
        ) AS x
      ),
      updated_at = now()
  WHERE c.id = p_atom_id;
END;
$$;

REVOKE ALL ON FUNCTION public.career_atom_project_evidence(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.career_atom_project_evidence(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.career_atom_project_parent(p_atom_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid;
  v_link public.career_atom_links%ROWTYPE;
  v_owned public.career_atom_parent_projection%ROWTYPE;
BEGIN
  SELECT user_id INTO v_user FROM public.career_atoms WHERE id = p_atom_id;
  IF v_user IS NULL THEN RETURN; END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> v_user THEN
    RAISE EXCEPTION 'Ikke tilgang';
  END IF;

  SELECT l.* INTO v_link
  FROM public.career_atom_links l
  JOIN public.career_atoms t ON t.id = l.to_atom_id
  JOIN public.career_atoms f ON f.id = l.from_atom_id
  WHERE l.from_atom_id = p_atom_id
    AND l.link_type = 'oppnadd_i'
    AND l.status = 'aktiv'
    AND l.superseded_at IS NULL
    AND t.is_active
    AND f.is_active
  LIMIT 1;

  SELECT * INTO v_owned FROM public.career_atom_parent_projection WHERE atom_id = p_atom_id;

  IF v_link.id IS NOT NULL THEN
    INSERT INTO public.career_atom_parent_projection (atom_id, user_id, parent_atom_id, link_id)
    VALUES (p_atom_id, v_user, v_link.to_atom_id, v_link.id)
    ON CONFLICT (atom_id) DO UPDATE
      SET parent_atom_id = EXCLUDED.parent_atom_id,
          link_id = EXCLUDED.link_id;

    UPDATE public.career_atoms
    SET parent_atom_id = v_link.to_atom_id, updated_at = now()
    WHERE id = p_atom_id
      AND (parent_atom_id IS NULL
           OR parent_atom_id IS DISTINCT FROM v_link.to_atom_id)
      AND (v_owned.atom_id IS NOT NULL OR parent_atom_id IS NULL);
  ELSE
    -- Nullstill kun en forelder projeksjonen selv eier.
    IF v_owned.atom_id IS NOT NULL THEN
      UPDATE public.career_atoms
      SET parent_atom_id = NULL, updated_at = now()
      WHERE id = p_atom_id AND parent_atom_id IS NOT DISTINCT FROM v_owned.parent_atom_id;
      DELETE FROM public.career_atom_parent_projection WHERE atom_id = p_atom_id;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.career_atom_project_parent(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.career_atom_project_parent(uuid) TO service_role;

-- ------------------------------------------------------------- lenke-RPC-er
CREATE OR REPLACE FUNCTION public.career_atom_link_suggest(
  p_from_atom_id uuid,
  p_to_atom_id uuid,
  p_link_type text,
  p_review_import_id uuid,
  p_source_candidate_id uuid DEFAULT NULL,
  p_confidence text DEFAULT 'lav',
  p_reasons jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_owner uuid;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Ikke innlogget'; END IF;
  SELECT user_id INTO v_owner FROM public.career_atoms WHERE id = p_from_atom_id;
  IF v_owner IS DISTINCT FROM v_user THEN RAISE EXCEPTION 'Ikke tilgang'; END IF;

  SELECT id INTO v_id FROM public.career_atom_links
  WHERE user_id = v_user AND from_atom_id = p_from_atom_id
    AND to_atom_id = p_to_atom_id AND link_type = p_link_type
    AND superseded_at IS NULL;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.career_atom_links (
    user_id, from_atom_id, to_atom_id, link_type, decided_by, status,
    confidence, reasons, review_import_id, source_candidate_id
  ) VALUES (
    v_user, p_from_atom_id, p_to_atom_id, p_link_type, 'machine_suggested', 'foreslatt',
    p_confidence, COALESCE(p_reasons, '{}'::jsonb), p_review_import_id, p_source_candidate_id
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.career_atom_link_suggest(uuid,uuid,text,uuid,uuid,text,jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.career_atom_link_suggest(uuid,uuid,text,uuid,uuid,text,jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.career_atom_link_decide(
  p_link_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_link public.career_atom_links%ROWTYPE;
  v_status text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Ikke innlogget'; END IF;
  SELECT * INTO v_link FROM public.career_atom_links WHERE id = p_link_id FOR UPDATE;
  IF v_link.id IS NULL OR v_link.user_id <> v_user THEN RAISE EXCEPTION 'Ikke tilgang'; END IF;
  IF v_link.superseded_at IS NOT NULL THEN RAISE EXCEPTION 'Koblingen er erstattet'; END IF;

  v_status := CASE p_decision
    WHEN 'bekreft' THEN 'aktiv'
    WHEN 'avvis' THEN 'avvist'
    WHEN 'ny_vurdering' THEN 'trenger_ny_vurdering'
    ELSE NULL END;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Ukjent beslutning'; END IF;

  UPDATE public.career_atom_links
  SET status = v_status,
      decided_by = CASE WHEN v_status = 'trenger_ny_vurdering' THEN decided_by ELSE 'user_confirmed' END,
      decided_at = now(),
      decided_by_user_id = v_user,
      reasons = CASE WHEN p_reason IS NULL THEN reasons
                     ELSE reasons || jsonb_build_object('decision_note', p_reason) END
  WHERE id = p_link_id;

  PERFORM public.career_atom_project_evidence(v_link.from_atom_id);
  IF v_link.link_type = 'oppnadd_i' THEN
    PERFORM public.career_atom_project_parent(v_link.from_atom_id);
  END IF;

  RETURN jsonb_build_object('link_id', p_link_id, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.career_atom_link_decide(uuid,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.career_atom_link_decide(uuid,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.career_atom_link_override(
  p_link_id uuid,
  p_new_to_atom_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_old public.career_atom_links%ROWTYPE;
  v_new uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Ikke innlogget'; END IF;
  SELECT * INTO v_old FROM public.career_atom_links WHERE id = p_link_id FOR UPDATE;
  IF v_old.id IS NULL OR v_old.user_id <> v_user THEN RAISE EXCEPTION 'Ikke tilgang'; END IF;
  IF v_old.superseded_at IS NOT NULL THEN RAISE EXCEPTION 'Koblingen er allerede erstattet'; END IF;

  UPDATE public.career_atom_links
  SET superseded_at = now(),
      superseded_reason = COALESCE(p_reason, 'Overstyrt av bruker'),
      status = CASE WHEN status = 'aktiv' THEN 'avvist' ELSE status END
  WHERE id = p_link_id;

  INSERT INTO public.career_atom_links (
    user_id, from_atom_id, to_atom_id, link_type, decided_by, status,
    confidence, reasons, review_import_id, source_candidate_id,
    supersedes_link_id, decided_at, decided_by_user_id
  ) VALUES (
    v_user, v_old.from_atom_id, p_new_to_atom_id, v_old.link_type, 'user_overridden', 'aktiv',
    v_old.confidence, v_old.reasons || jsonb_build_object('overridden_from', v_old.to_atom_id),
    v_old.review_import_id, v_old.source_candidate_id,
    v_old.id, now(), v_user
  ) RETURNING id INTO v_new;

  PERFORM public.career_atom_project_evidence(v_old.from_atom_id);
  IF v_old.link_type = 'oppnadd_i' THEN
    PERFORM public.career_atom_project_parent(v_old.from_atom_id);
  END IF;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.career_atom_link_override(uuid,uuid,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.career_atom_link_override(uuid,uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.career_atom_links_mark_recheck(p_atom_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_owner uuid;
  v_ids uuid[];
  v_n int := 0;
  v_id uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.career_atoms WHERE id = p_atom_id;
  IF v_owner IS NULL THEN RETURN 0; END IF;
  IF v_user IS NOT NULL AND v_user <> v_owner THEN RAISE EXCEPTION 'Ikke tilgang'; END IF;

  WITH upd AS (
    UPDATE public.career_atom_links
    SET status = 'trenger_ny_vurdering'
    WHERE superseded_at IS NULL
      AND status IN ('aktiv','foreslatt')
      AND (from_atom_id = p_atom_id OR to_atom_id = p_atom_id)
    RETURNING from_atom_id
  )
  SELECT COALESCE(array_agg(DISTINCT from_atom_id), '{}'), count(*) INTO v_ids, v_n FROM upd;

  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM public.career_atom_project_evidence(v_id);
    PERFORM public.career_atom_project_parent(v_id);
  END LOOP;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.career_atom_links_mark_recheck(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.career_atom_links_mark_recheck(uuid) TO authenticated, service_role;

-- --------------------------------------------------------- fremdrift
CREATE TABLE public.cv_review_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  import_id uuid NOT NULL REFERENCES public.cv_imports(id) ON DELETE CASCADE,
  candidate_set_signature text NOT NULL,
  analysis_version text NOT NULL,
  current_step smallint NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 4),
  step_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_stale boolean NOT NULL DEFAULT false,
  stale_reason text,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, import_id, candidate_set_signature)
);
CREATE UNIQUE INDEX cv_review_progress_one_live
  ON public.cv_review_progress (user_id, import_id) WHERE is_stale = false;

GRANT SELECT ON public.cv_review_progress TO authenticated;
GRANT ALL ON public.cv_review_progress TO service_role;
ALTER TABLE public.cv_review_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "review_progress_select_own" ON public.cv_review_progress
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.cv_review_progress_sync(
  p_import_id uuid,
  p_signature text,
  p_analysis_version text
)
RETURNS public.cv_review_progress
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_owner uuid;
  v_row public.cv_review_progress%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Ikke innlogget'; END IF;
  SELECT user_id INTO v_owner FROM public.cv_imports WHERE id = p_import_id;
  IF v_owner IS DISTINCT FROM v_user THEN RAISE EXCEPTION 'Ikke tilgang'; END IF;

  SELECT * INTO v_row FROM public.cv_review_progress
  WHERE user_id = v_user AND import_id = p_import_id AND is_stale = false
  FOR UPDATE;

  IF v_row.id IS NOT NULL AND v_row.candidate_set_signature = p_signature THEN
    RETURN v_row;
  END IF;

  IF v_row.id IS NOT NULL THEN
    UPDATE public.cv_review_progress
    SET is_stale = true,
        stale_reason = 'Kandidatsettet er endret',
        superseded_at = now(),
        updated_at = now()
    WHERE id = v_row.id;
  END IF;

  INSERT INTO public.cv_review_progress (user_id, import_id, candidate_set_signature, analysis_version)
  VALUES (v_user, p_import_id, p_signature, p_analysis_version)
  ON CONFLICT (user_id, import_id, candidate_set_signature)
    DO UPDATE SET is_stale = false, stale_reason = NULL, superseded_at = NULL, updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cv_review_progress_sync(uuid,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cv_review_progress_sync(uuid,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cv_review_progress_advance(
  p_import_id uuid,
  p_signature text,
  p_step smallint,
  p_step_state jsonb DEFAULT NULL
)
RETURNS public.cv_review_progress
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.cv_review_progress%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Ikke innlogget'; END IF;

  SELECT * INTO v_row FROM public.cv_review_progress
  WHERE user_id = v_user AND import_id = p_import_id AND is_stale = false
  FOR UPDATE;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Ingen aktiv gjennomgang for denne importen'; END IF;
  IF v_row.candidate_set_signature <> p_signature THEN
    RAISE EXCEPTION 'Gjennomgangen gjelder et annet kandidatsett. Start gjennomgangen på nytt.';
  END IF;
  IF p_step < 1 OR p_step > 4 THEN RAISE EXCEPTION 'Ukjent trinn'; END IF;
  IF p_step > v_row.current_step + 1 THEN RAISE EXCEPTION 'Trinnene må tas i rekkefølge'; END IF;

  UPDATE public.cv_review_progress
  SET current_step = p_step,
      step_state = COALESCE(p_step_state, step_state),
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cv_review_progress_advance(uuid,text,smallint,jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cv_review_progress_advance(uuid,text,smallint,jsonb) TO authenticated, service_role;

-- ------------------------------------------------- privat tidslinjekontekst
CREATE TABLE public.cv_review_timeline_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  import_id uuid REFERENCES public.cv_imports(id) ON DELETE SET NULL,
  gap_start date NOT NULL,
  gap_end date NOT NULL,
  category text NOT NULL CHECK (category IN ('studier','permisjon','sabbatsar','selvstendig','annet')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cv_review_timeline_context_user_idx ON public.cv_review_timeline_context (user_id, gap_start);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cv_review_timeline_context TO authenticated;
GRANT ALL ON public.cv_review_timeline_context TO service_role;
ALTER TABLE public.cv_review_timeline_context ENABLE ROW LEVEL SECURITY;
CREATE POLICY "timeline_context_own" ON public.cv_review_timeline_context
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ------------------------------------- arkivering i stedet for hard sletting
CREATE OR REPLACE FUNCTION public.career_atom_delete(p_atom_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_removed uuid[];
  v_touched uuid[];
  v_unlinked int := 0;
  v_unbacked int := 0;
  v_links int := 0;
  v_id uuid;
BEGIN
  WITH RECURSIVE tree AS (
    SELECT c.id, 0 AS depth FROM public.career_atoms c WHERE c.id = p_atom_id
    UNION ALL
    SELECT c.id, t.depth + 1
    FROM public.career_atoms c JOIN tree t ON c.parent_atom_id = t.id
    WHERE t.depth < 10
  )
  SELECT COALESCE(array_agg(id), '{}') INTO v_removed FROM tree;

  IF cardinality(v_removed) = 0 THEN
    RETURN jsonb_build_object('found', false, 'deleted', 0, 'archived', 0,
                              'unlinked', 0, 'unbacked', 0, 'orphaned', 0, 'links_recheck', 0);
  END IF;

  -- Arkiver i stedet for å slette: koblingshistorikken skal bestå.
  UPDATE public.career_atoms
  SET is_active = false, updated_at = now()
  WHERE id = ANY(v_removed);

  -- Merk alle berørte koblinger for ny vurdering og oppdater projeksjonene.
  FOREACH v_id IN ARRAY v_removed LOOP
    v_links := v_links + public.career_atom_links_mark_recheck(v_id);
  END LOOP;

  -- Fjern pekere til det arkiverte fra kompetanse/eksponering som pekte hit.
  WITH upd AS (
    UPDATE public.career_atoms c
    SET evidence_atom_ids = ARRAY(
      SELECT unnest(COALESCE(c.evidence_atom_ids, '{}')) EXCEPT SELECT unnest(v_removed)
    )
    WHERE c.is_active
      AND NOT (c.id = ANY(v_removed))
      AND COALESCE(c.evidence_atom_ids, '{}') && v_removed
    RETURNING c.id
  )
  SELECT COALESCE(array_agg(id), '{}'), count(*) INTO v_touched, v_unlinked FROM upd;

  WITH unb AS (
    UPDATE public.career_atoms c
    SET confidence = 'inferred',
        structured_data = COALESCE(c.structured_data, '{}'::jsonb)
          || jsonb_build_object('mangler_belegg', true, 'mangler_belegg_siden', now()),
        updated_at = now()
    WHERE c.id = ANY(v_touched)
      AND c.atom_kind = 'evidens'
      AND c.atom_class IN ('kompetanse', 'eksponering')
      AND c.parent_atom_id IS NULL
      AND cardinality(COALESCE(c.evidence_atom_ids, '{}')) = 0
    RETURNING c.id
  )
  SELECT count(*) INTO v_unbacked FROM unb;

  RETURN jsonb_build_object(
    'found', true,
    'deleted', cardinality(v_removed),
    'archived', cardinality(v_removed),
    'unlinked', v_unlinked,
    'unbacked', v_unbacked,
    'orphaned', 0,
    'links_recheck', v_links
  );
END;
$$;

-- Konsekvensoppslaget rapporterer også berørte koblinger.
CREATE OR REPLACE FUNCTION public.career_atom_delete_impact_links(p_atom_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH RECURSIVE tree AS (
  SELECT c.id, 0 AS depth FROM public.career_atoms c WHERE c.id = p_atom_id
  UNION ALL
  SELECT c.id, t.depth + 1 FROM public.career_atoms c JOIN tree t ON c.parent_atom_id = t.id
  WHERE t.depth < 10
)
SELECT jsonb_build_object(
  'active_links', COALESCE((
    SELECT count(*) FROM public.career_atom_links l
    WHERE l.superseded_at IS NULL AND l.status = 'aktiv'
      AND (l.from_atom_id IN (SELECT id FROM tree) OR l.to_atom_id IN (SELECT id FROM tree))
  ), 0),
  'historic_links', COALESCE((
    SELECT count(*) FROM public.career_atom_links l
    WHERE (l.superseded_at IS NOT NULL OR l.status <> 'aktiv')
      AND (l.from_atom_id IN (SELECT id FROM tree) OR l.to_atom_id IN (SELECT id FROM tree))
  ), 0),
  'results_losing_placement', COALESCE((
    SELECT count(*) FROM public.career_atom_parent_projection p
    WHERE p.parent_atom_id IN (SELECT id FROM tree)
  ), 0)
);
$$;

REVOKE ALL ON FUNCTION public.career_atom_delete_impact_links(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.career_atom_delete_impact_links(uuid) TO authenticated, service_role;