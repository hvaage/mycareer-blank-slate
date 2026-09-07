-- ============================================================
-- Universum som kildebelagt datakilde for arbeidsgiverinnsikt
-- Additivt. Ingen eksisterende kontrakt endres destruktivt.
-- ============================================================

-- 1) Kontrollert navnenormalisering (deterministisk, IMMUTABLE)
CREATE OR REPLACE FUNCTION public.universum_normalize_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            translate(
              lower(coalesce(p_name, '')),
              'æøåäöüéèêáàâíìóòôç',
              'aoaaouee' || 'e' || 'aaaiioo' || 'oc'
            ),
            '[^a-z0-9]+', ' ', 'g'
          ),
          '\s+(asa|as|ans|ba|sa|ab|aps|oyj|oy|plc|ltd|limited|inc|llc|gmbh|nuf|da|kf|hf|ehf|sf|iks|group|gruppen|norge|norway)(\s|$)',
          ' ', 'g'
        ),
        '\s+', ' ', 'g'
      )
    ),
    ''
  );
$$;

COMMENT ON FUNCTION public.universum_normalize_name(text) IS
  'Kontrollert navnenormalisering for Universum-matching. Fjerner selskapsform og landssuffiks. Aldri fuzzy.';

-- 2) Versjonerte målinger (årganger overskrives ikke)
CREATE TABLE public.universum_survey_editions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market text NOT NULL,
  segment text NOT NULL,
  field text NOT NULL,
  survey_year integer NOT NULL,
  source_name text NOT NULL,
  source_url text NOT NULL,
  access_note text,
  total_ranked integer,
  registered_entries integer NOT NULL DEFAULT 0,
  coverage_note text,
  key_insights jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT universum_survey_editions_year_ck CHECK (survey_year BETWEEN 2000 AND 2100),
  CONSTRAINT universum_survey_editions_unique_edition
    UNIQUE (market, segment, field, survey_year)
);

GRANT ALL ON public.universum_survey_editions TO service_role;
ALTER TABLE public.universum_survey_editions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "universum_editions_admin_read"
  ON public.universum_survey_editions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3) Plasseringer per årgang
CREATE TABLE public.universum_ranking_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id uuid NOT NULL
    REFERENCES public.universum_survey_editions(id) ON DELETE CASCADE,
  rank integer NOT NULL,
  employer_name text NOT NULL,
  employer_name_normalized text GENERATED ALWAYS AS
    (public.universum_normalize_name(employer_name)) STORED,
  previous_rank integer,
  trend_from_previous text NOT NULL DEFAULT 'unknown',
  evidence_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT universum_entries_rank_ck CHECK (rank >= 1),
  CONSTRAINT universum_entries_prev_rank_ck CHECK (previous_rank IS NULL OR previous_rank >= 1),
  CONSTRAINT universum_entries_trend_ck
    CHECK (trend_from_previous IN ('up', 'down', 'unchanged', 'new', 'unknown')),
  CONSTRAINT universum_entries_unique_rank UNIQUE (edition_id, rank)
);

CREATE UNIQUE INDEX universum_entries_unique_name
  ON public.universum_ranking_entries (edition_id, employer_name_normalized);

CREATE INDEX universum_entries_name_lookup
  ON public.universum_ranking_entries (employer_name_normalized);

GRANT ALL ON public.universum_ranking_entries TO service_role;
ALTER TABLE public.universum_ranking_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "universum_entries_admin_read"
  ON public.universum_ranking_entries FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 4) Eksplisitt aliasmekanisme (orgnr -> navn i Universum-listen)
CREATE TABLE public.universum_employer_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisasjonsnummer text NOT NULL,
  alias_name text NOT NULL,
  alias_normalized text GENERATED ALWAYS AS
    (public.universum_normalize_name(alias_name)) STORED,
  note text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT universum_alias_orgnr_ck CHECK (organisasjonsnummer ~ '^[0-9]{9}$')
);

-- Ett aktivt alias per orgnr, og ett orgnr per aktivt aliasnavn.
CREATE UNIQUE INDEX universum_alias_unique_orgnr
  ON public.universum_employer_aliases (organisasjonsnummer) WHERE is_active;
CREATE UNIQUE INDEX universum_alias_unique_name
  ON public.universum_employer_aliases (alias_normalized) WHERE is_active;

GRANT ALL ON public.universum_employer_aliases TO service_role;
ALTER TABLE public.universum_employer_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "universum_aliases_admin_read"
  ON public.universum_employer_aliases FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 5) updated_at-triggere
CREATE OR REPLACE FUNCTION public._universum_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER universum_editions_touch
  BEFORE UPDATE ON public.universum_survey_editions
  FOR EACH ROW EXECUTE FUNCTION public._universum_touch_updated_at();
CREATE TRIGGER universum_entries_touch
  BEFORE UPDATE ON public.universum_ranking_entries
  FOR EACH ROW EXECUTE FUNCTION public._universum_touch_updated_at();
CREATE TRIGGER universum_aliases_touch
  BEFORE UPDATE ON public.universum_employer_aliases
  FOR EACH ROW EXECUTE FUNCTION public._universum_touch_updated_at();

-- 6) Oppslag: kun entydig, kildebelagt treff gir svar
CREATE OR REPLACE FUNCTION public.get_universum_market_insight(
  p_organisasjonsnummer text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, reg, pg_temp
AS $$
DECLARE
  v_orgnr text := regexp_replace(coalesce(p_organisasjonsnummer, ''), '\D', '', 'g');
  v_edition public.universum_survey_editions%ROWTYPE;
  v_alias text;
  v_legal_name text;
  v_company_name text;
  v_match_count integer := 0;
  v_entry public.universum_ranking_entries%ROWTYPE;
BEGIN
  IF v_orgnr !~ '^[0-9]{9}$' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_edition
  FROM public.universum_survey_editions
  WHERE is_active
  ORDER BY survey_year DESC, created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT alias_normalized INTO v_alias
  FROM public.universum_employer_aliases
  WHERE organisasjonsnummer = v_orgnr AND is_active
  LIMIT 1;

  IF v_alias IS NOT NULL THEN
    -- Eksplisitt alias er autoritativt. Finnes ikke navnet i listen: ingen treff.
    SELECT * INTO v_entry
    FROM public.universum_ranking_entries
    WHERE edition_id = v_edition.id
      AND employer_name_normalized = v_alias
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
  ELSE
    SELECT e.navn INTO v_legal_name
    FROM reg.enheter e
    WHERE e.organisasjonsnummer = v_orgnr
    LIMIT 1;

    SELECT c.name INTO v_company_name
    FROM public.companies c
    WHERE c.organisasjonsnummer = v_orgnr
    LIMIT 1;

    SELECT count(*) INTO v_match_count
    FROM public.universum_ranking_entries r
    WHERE r.edition_id = v_edition.id
      AND r.employer_name_normalized IN (
        public.universum_normalize_name(v_legal_name),
        public.universum_normalize_name(v_company_name)
      );

    -- 0 treff = ukjent. Flere treff = tvetydig. Ingen gjetting i noen av tilfellene.
    IF v_match_count <> 1 THEN
      RETURN NULL;
    END IF;

    SELECT * INTO v_entry
    FROM public.universum_ranking_entries r
    WHERE r.edition_id = v_edition.id
      AND r.employer_name_normalized IN (
        public.universum_normalize_name(v_legal_name),
        public.universum_normalize_name(v_company_name)
      )
    LIMIT 1;
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'schema_version', 1,
    'year', v_edition.survey_year,
    'segment', v_edition.segment,
    'field', v_edition.field,
    'market', v_edition.market,
    'rank', v_entry.rank,
    'previous_rank', v_entry.previous_rank,
    'trend_from_2025', v_entry.trend_from_previous,
    'total_ranked', v_edition.total_ranked,
    'match_method', CASE WHEN v_alias IS NOT NULL THEN 'explicit_alias' ELSE 'normalized_legal_name' END,
    'employer_name_in_ranking', v_entry.employer_name,
    'source_name', v_edition.source_name,
    'source_url', coalesce(v_entry.evidence_url, v_edition.source_url),
    'access_note', v_edition.access_note,
    'fetched_at', v_edition.fetched_at,
    'measures', 'student_preference',
    'disclaimer', 'Studentpreferanse, ikke en kvalitetsvurdering av arbeidsgiveren.'
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.get_universum_market_insight(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_universum_market_insight(text) TO anon, authenticated, service_role;

-- 7) Åpne nøkkelinnsikter for kildevisning (ingen arbeidsgiverkobling)
CREATE OR REPLACE FUNCTION public.get_universum_source_overview()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'schema_version', 1,
    'year', e.survey_year,
    'market', e.market,
    'segment', e.segment,
    'field', e.field,
    'source_name', e.source_name,
    'source_url', e.source_url,
    'access_note', e.access_note,
    'total_ranked', e.total_ranked,
    'registered_entries', e.registered_entries,
    'coverage_note', e.coverage_note,
    'key_insights', e.key_insights,
    'fetched_at', e.fetched_at,
    'measures', 'student_preference'
  ))
  FROM public.universum_survey_editions e
  WHERE e.is_active
  ORDER BY e.survey_year DESC, e.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_universum_source_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_universum_source_overview() TO anon, authenticated, service_role;

-- 8) Adgangsstyrt vedlikehold av årganger og plasseringer
CREATE OR REPLACE FUNCTION public.universum_upsert_edition(
  p_market text,
  p_segment text,
  p_field text,
  p_survey_year integer,
  p_source_name text,
  p_source_url text,
  p_access_note text DEFAULT NULL,
  p_total_ranked integer DEFAULT NULL,
  p_coverage_note text DEFAULT NULL,
  p_key_insights jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.universum_survey_editions AS e (
    market, segment, field, survey_year, source_name, source_url,
    access_note, total_ranked, coverage_note, key_insights
  )
  VALUES (
    p_market, p_segment, p_field, p_survey_year, p_source_name, p_source_url,
    p_access_note, p_total_ranked, p_coverage_note, coalesce(p_key_insights, '{}'::jsonb)
  )
  ON CONFLICT (market, segment, field, survey_year) DO UPDATE
    SET source_name = excluded.source_name,
        source_url = excluded.source_url,
        access_note = excluded.access_note,
        total_ranked = excluded.total_ranked,
        coverage_note = excluded.coverage_note,
        key_insights = excluded.key_insights,
        fetched_at = now()
  RETURNING e.id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.universum_upsert_edition(text,text,text,integer,text,text,text,integer,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.universum_upsert_edition(text,text,text,integer,text,text,text,integer,text,jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.universum_replace_edition_entries(
  p_edition_id uuid,
  p_entries jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'entries_must_be_array' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.universum_ranking_entries WHERE edition_id = p_edition_id;

  INSERT INTO public.universum_ranking_entries (
    edition_id, rank, employer_name, previous_rank, trend_from_previous, evidence_url
  )
  SELECT
    p_edition_id,
    (x->>'rank')::integer,
    x->>'employer_name',
    nullif(x->>'previous_rank', '')::integer,
    coalesce(nullif(x->>'trend_from_previous', ''), 'unknown'),
    nullif(x->>'evidence_url', '')
  FROM jsonb_array_elements(p_entries) AS x;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.universum_survey_editions
  SET registered_entries = v_count
  WHERE id = p_edition_id;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.universum_replace_edition_entries(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.universum_replace_edition_entries(uuid, jsonb) TO authenticated, service_role;

-- 9) Utvid eksisterende analysekontrakt additivt med market_insights
CREATE OR REPLACE FUNCTION public.get_employer_analysis_view(p_organisasjonsnummer text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'reg', 'pg_temp'
AS $function$
DECLARE
  v_orgnr text := regexp_replace(coalesce(p_organisasjonsnummer, ''), '\D', '', 'g');
  v_uid uuid := auth.uid();
  v_company public.companies%ROWTYPE;
  v_analysis jsonb;
  v_register jsonb;
  v_admin public.employer_analysis_weight_profiles%ROWTYPE;
  v_user public.user_employer_analysis_weights%ROWTYPE;
  v_employer_weights jsonb;
  v_ai_weights jsonb;
  v_is_customized boolean := false;
  v_universum jsonb;
  v_market_insights jsonb;
BEGIN
  IF v_orgnr !~ '^[0-9]{9}$' THEN
    RAISE EXCEPTION 'invalid_organisasjonsnummer' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_company
  FROM public.companies
  WHERE organisasjonsnummer = v_orgnr
  LIMIT 1;

  v_analysis := public._employer_analysis_public_projection(v_company.employer_analysis_v2);
  v_register := public.get_employer_analysis_context(v_orgnr);

  SELECT * INTO v_admin
  FROM public.employer_analysis_weight_profiles
  WHERE profile_key = 'public_default' AND is_active
  ORDER BY version DESC
  LIMIT 1;

  v_employer_weights := coalesce(
    v_admin.employer_weights,
    public._employer_analysis_default_weights('employer')
  );
  v_ai_weights := coalesce(
    v_admin.ai_weights,
    public._employer_analysis_default_weights('ai')
  );

  IF v_uid IS NOT NULL THEN
    SELECT * INTO v_user
    FROM public.user_employer_analysis_weights
    WHERE user_id = v_uid;
    IF FOUND THEN
      v_is_customized := true;
    END IF;
  END IF;

  v_universum := public.get_universum_market_insight(v_orgnr);
  v_market_insights := CASE
    WHEN v_universum IS NULL THEN NULL
    ELSE jsonb_build_object('universum', v_universum)
  END;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'organisasjonsnummer', v_orgnr,
    'company', jsonb_strip_nulls(jsonb_build_object(
      'id', v_company.id,
      'name', coalesce(v_company.name, v_register #>> '{entity,legal_name}'),
      'domain', v_company.domain,
      'industry', coalesce(v_company.industry, v_register #>> '{entity,industry_primary}'),
      'analysis_version', v_company.employer_analysis_version,
      'analysis_rated_at', v_company.employer_analysis_rated_at,
      'analysis_source_updated_at', v_company.employer_analysis_source_updated_at
    )),
    'register', v_register,
    'financials', v_company.financials,
    'analysis', v_analysis,
    'market_insights', v_market_insights,
    'weighting', jsonb_build_object(
      'admin_profile', jsonb_build_object(
        'version', coalesce(v_admin.version, 1),
        'employer_weights', v_employer_weights,
        'ai_weights', v_ai_weights
      ),
      'public', jsonb_build_object(
        'employer', public._employer_analysis_weighted_score(
          v_analysis, v_employer_weights, 'employer'
        ),
        'ai', public._employer_analysis_weighted_score(
          v_analysis, v_ai_weights, 'ai'
        )
      ),
      'personal', CASE WHEN v_uid IS NULL THEN NULL ELSE jsonb_build_object(
        'is_customized', v_is_customized,
        'employer_weights', coalesce(v_user.employer_weights, v_employer_weights),
        'ai_weights', coalesce(v_user.ai_weights, v_ai_weights),
        'employer', public._employer_analysis_weighted_score(
          v_analysis,
          coalesce(v_user.employer_weights, v_employer_weights),
          'employer'
        ),
        'ai', public._employer_analysis_weighted_score(
          v_analysis,
          coalesce(v_user.ai_weights, v_ai_weights),
          'ai'
        )
      ) END
    )
  );
END;
$function$;