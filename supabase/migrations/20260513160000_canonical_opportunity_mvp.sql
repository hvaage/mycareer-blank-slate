-- Canonical opportunity MVP (Careerjet first). Legacy job_listings / user_job_listing_status unchanged.

-- ---------------------------------------------------------------------------
-- Deterministic fingerprint: md5 of normalize_lead_key('', company, title, location)
-- (pgcrypto not required; md5(text) is built-in.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.opportunity_fingerprint(
  p_company text,
  p_title text,
  p_location text
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT 'fp1:' || md5(
    coalesce(
      public.normalize_lead_key(
        '',
        coalesce(p_company, ''),
        coalesce(p_title, ''),
        coalesce(p_location, '')
      ),
      ''
    )
  );
$$;

COMMENT ON FUNCTION public.opportunity_fingerprint(text, text, text) IS
  'Stable identity for one logical job ad; aligns with cmp: branch of normalize_lead_key.';

-- ---------------------------------------------------------------------------
-- source_postings: raw evidence per upstream posting (URL variants, etc.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.source_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  source_external_id text NOT NULL,
  listing_id uuid REFERENCES public.job_listings(id) ON DELETE SET NULL,
  raw_url text NOT NULL,
  display_url text NOT NULL,
  title text,
  company text,
  location text,
  description_excerpt text,
  raw_payload jsonb,
  identity_fingerprint text NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_postings_source_external_unique UNIQUE (source, source_external_id)
);

CREATE INDEX IF NOT EXISTS idx_source_postings_fingerprint ON public.source_postings (identity_fingerprint);
CREATE INDEX IF NOT EXISTS idx_source_postings_listing ON public.source_postings (listing_id);

-- ---------------------------------------------------------------------------
-- canonical_opportunities: one row per identity fingerprint
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.canonical_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_fingerprint text NOT NULL,
  display_title text,
  display_company text,
  display_location text,
  display_url text NOT NULL,
  primary_source text NOT NULL DEFAULT 'careerjet',
  merge_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canonical_opportunities_fingerprint_unique UNIQUE (identity_fingerprint)
);

-- ---------------------------------------------------------------------------
-- opportunity_source_links: canonical ↔ source_posting (primary vs variant)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.opportunity_source_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_opportunity_id uuid NOT NULL REFERENCES public.canonical_opportunities(id) ON DELETE CASCADE,
  source_posting_id uuid NOT NULL REFERENCES public.source_postings(id) ON DELETE CASCADE,
  link_role text NOT NULL CHECK (link_role IN ('primary', 'variant')),
  merge_reason text NOT NULL DEFAULT 'import',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_source_links_unique UNIQUE (canonical_opportunity_id, source_posting_id)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_source_links_canonical ON public.opportunity_source_links (canonical_opportunity_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_source_links_posting ON public.opportunity_source_links (source_posting_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_source_one_primary
  ON public.opportunity_source_links (canonical_opportunity_id)
  WHERE link_role = 'primary';

-- ---------------------------------------------------------------------------
-- user_opportunities: per-user card + status (one row per user × canonical)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  canonical_opportunity_id uuid NOT NULL REFERENCES public.canonical_opportunities(id) ON DELETE CASCADE,
  identity_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'saved', 'applied', 'dismissed')),
  relevance_score numeric(5, 2),
  ai_score numeric(5, 2),
  ai_reasoning text,
  ai_match_highlights text,
  ai_concerns text,
  ai_scored_at timestamptz,
  legacy_listing_status_id uuid REFERENCES public.user_job_listing_status(id) ON DELETE SET NULL,
  legacy_listing_id uuid REFERENCES public.job_listings(id) ON DELETE SET NULL,
  card_title text,
  card_company text,
  card_location text,
  card_salary text,
  card_salary_min numeric,
  card_salary_max numeric,
  card_salary_currency text,
  card_display_url text NOT NULL,
  card_raw_url text NOT NULL,
  card_published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_opportunities_user_canonical_unique UNIQUE (user_id, canonical_opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_user_opportunities_user_status ON public.user_opportunities (user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_opportunities_fingerprint ON public.user_opportunities (user_id, identity_fingerprint);

-- ---------------------------------------------------------------------------
-- opportunity_dedup_candidates: future Gmail/LinkedIn merge review queue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.opportunity_dedup_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  fingerprint_a text NOT NULL,
  fingerprint_b text NOT NULL,
  confidence numeric(5, 4),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'merged')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunity_dedup_candidates_user ON public.opportunity_dedup_candidates (user_id, status);

-- ---------------------------------------------------------------------------
-- opportunity_dedup_decisions: audit trail for merges
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.opportunity_dedup_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  keep_canonical_id uuid REFERENCES public.canonical_opportunities(id) ON DELETE SET NULL,
  merged_canonical_id uuid REFERENCES public.canonical_opportunities(id) ON DELETE SET NULL,
  decision_type text NOT NULL,
  reason text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunity_dedup_decisions_keep ON public.opportunity_dedup_decisions (keep_canonical_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.source_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_source_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_dedup_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_dedup_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "source_postings_select_via_user_opportunity" ON public.source_postings;
CREATE POLICY "source_postings_select_via_user_opportunity"
  ON public.source_postings FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.opportunity_source_links osl
      JOIN public.user_opportunities uo ON uo.canonical_opportunity_id = osl.canonical_opportunity_id
      WHERE osl.source_posting_id = source_postings.id
        AND uo.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "canonical_opportunities_select_via_user" ON public.canonical_opportunities;
CREATE POLICY "canonical_opportunities_select_via_user"
  ON public.canonical_opportunities FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_opportunities uo
      WHERE uo.canonical_opportunity_id = canonical_opportunities.id
        AND uo.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "opportunity_source_links_select_via_user" ON public.opportunity_source_links;
CREATE POLICY "opportunity_source_links_select_via_user"
  ON public.opportunity_source_links FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_opportunities uo
      WHERE uo.canonical_opportunity_id = opportunity_source_links.canonical_opportunity_id
        AND uo.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "user_opportunities_all_own" ON public.user_opportunities;
CREATE POLICY "user_opportunities_all_own"
  ON public.user_opportunities FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "opportunity_dedup_candidates_own" ON public.opportunity_dedup_candidates;
CREATE POLICY "opportunity_dedup_candidates_own"
  ON public.opportunity_dedup_candidates FOR ALL TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id)
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

DROP POLICY IF EXISTS "opportunity_dedup_decisions_own" ON public.opportunity_dedup_decisions;
CREATE POLICY "opportunity_dedup_decisions_own"
  ON public.opportunity_dedup_decisions FOR ALL TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id)
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Sync AI fields from legacy listing status into user_opportunities
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_user_opportunity_ai_from_legacy(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.user_opportunities uo
  SET
    ai_score = uj.ai_score,
    ai_reasoning = uj.ai_reasoning,
    ai_match_highlights = uj.ai_match_highlights,
    ai_concerns = uj.ai_concerns,
    ai_scored_at = uj.ai_scored_at,
    updated_at = now()
  FROM public.user_job_listing_status uj
  WHERE uo.user_id = p_user_id
    AND uo.legacy_listing_status_id = uj.id
    AND uj.user_id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.sync_user_opportunity_ai_from_legacy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_user_opportunity_ai_from_legacy(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Unified Careerjet leads: canonical user_opportunities + one legacy row per fingerprint stragglers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_user_careerjet_leads(
  p_user_id uuid,
  p_status text DEFAULT 'all'
)
RETURNS TABLE (
  row_kind text,
  user_opportunity_id uuid,
  listing_status_id uuid,
  listing_id uuid,
  status text,
  relevance_score numeric,
  ai_score numeric,
  ai_reasoning text,
  ai_match_highlights text,
  ai_concerns text,
  title text,
  employer text,
  location text,
  salary text,
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  published_at timestamptz,
  source_url text,
  display_url text,
  raw_url text,
  identity_fingerprint text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    'canonical'::text AS row_kind,
    uo.id AS user_opportunity_id,
    uo.legacy_listing_status_id AS listing_status_id,
    uo.legacy_listing_id AS listing_id,
    uo.status,
    uo.relevance_score,
    uo.ai_score,
    uo.ai_reasoning,
    uo.ai_match_highlights,
    uo.ai_concerns,
    uo.card_title AS title,
    uo.card_company AS employer,
    uo.card_location AS location,
    uo.card_salary AS salary,
    uo.card_salary_min AS salary_min,
    uo.card_salary_max AS salary_max,
    uo.card_salary_currency AS salary_currency,
    uo.card_published_at AS published_at,
    jl.source_url,
    uo.card_display_url AS display_url,
    uo.card_raw_url AS raw_url,
    uo.identity_fingerprint
  FROM public.user_opportunities uo
  LEFT JOIN public.user_job_listing_status ujs ON ujs.id = uo.legacy_listing_status_id
  LEFT JOIN public.job_listings jl ON jl.id = COALESCE(uo.legacy_listing_id, ujs.listing_id)
  WHERE uo.user_id = p_user_id
    AND (
      p_status = 'all' AND uo.status <> 'dismissed'
      OR p_status = 'new' AND uo.status = 'new'
      OR p_status = 'saved' AND uo.status = 'saved'
      OR p_status = 'applied' AND uo.status = 'applied'
    );

  RETURN QUERY
  SELECT
    'legacy'::text,
    NULL::uuid,
    uj.id,
    jl.id,
    uj.status,
    uj.relevance_score,
    uj.ai_score,
    uj.ai_reasoning,
    uj.ai_match_highlights,
    uj.ai_concerns,
    jl.title,
    jl.employer,
    jl.location,
    jl.salary,
    jl.salary_min,
    jl.salary_max,
    jl.salary_currency,
    jl.published_at,
    jl.source_url,
    jl.source_url AS display_url,
    jl.source_url AS raw_url,
    public.opportunity_fingerprint(jl.employer, jl.title, jl.location) AS identity_fingerprint
  FROM (
    SELECT DISTINCT ON (public.opportunity_fingerprint(jl2.employer, jl2.title, jl2.location))
      uj2.id,
      uj2.user_id,
      uj2.status,
      uj2.relevance_score,
      uj2.ai_score,
      uj2.ai_reasoning,
      uj2.ai_match_highlights,
      uj2.ai_concerns,
      uj2.listing_id,
      public.opportunity_fingerprint(jl2.employer, jl2.title, jl2.location) AS fp
    FROM public.user_job_listing_status uj2
    JOIN public.job_listings jl2 ON jl2.id = uj2.listing_id
    WHERE uj2.user_id = p_user_id
      AND jl2.source = 'careerjet'
      AND NOT EXISTS (
        SELECT 1 FROM public.user_opportunities uo2
        WHERE uo2.user_id = p_user_id
          AND uo2.identity_fingerprint = public.opportunity_fingerprint(
            jl2.employer, jl2.title, jl2.location
          )
      )
      AND (
        p_status = 'all' AND uj2.status <> 'dismissed'
        OR p_status = 'new' AND uj2.status = 'new'
        OR p_status = 'saved' AND uj2.status = 'saved'
        OR p_status = 'applied' AND uj2.status = 'applied'
      )
    ORDER BY public.opportunity_fingerprint(jl2.employer, jl2.title, jl2.location), uj2.updated_at DESC NULLS LAST
  ) uj
  JOIN public.job_listings jl ON jl.id = uj.listing_id;
END;
$$;

REVOKE ALL ON FUNCTION public.list_user_careerjet_leads(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_user_careerjet_leads(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.list_user_careerjet_leads IS
  'Careerjet leads: user_opportunities (canonical) plus legacy rows not yet covered by a fingerprint.';

REVOKE ALL ON FUNCTION public.opportunity_fingerprint(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.opportunity_fingerprint(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.opportunity_fingerprint(text, text, text) TO service_role;
