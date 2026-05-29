-- applications_with_urgency — read model for dashboard / application list.
CREATE OR REPLACE VIEW public.applications_with_urgency
WITH (security_invoker = true)
AS
SELECT
  a.applied_date,
  a.available_from,
  a.company_linkedin,
  a.company_name,
  a.company_size,
  a.company_website,
  a.contact_email,
  a.contact_linkedin,
  a.contact_name,
  a.created_at,
  CASE
    WHEN a.applied_date IS NOT NULL THEN (CURRENT_DATE - a.applied_date)::integer
  END AS days_since_applied,
  GREATEST(
    0,
    FLOOR(EXTRACT(EPOCH FROM (timezone('UTC', now()) - a.updated_at)) / 86400)::integer
  ) AS days_since_update,
  COALESCE(
    (SELECT COUNT(*)::bigint FROM public.documents d WHERE d.application_id = a.id),
    0::bigint
  ) AS document_count,
  a.id,
  a.industry,
  a.internal_assessment,
  a.is_starred,
  a.job_url,
  a.location,
  0::bigint AS meeting_count,
  a.notes,
  0::bigint AS open_tasks,
  a.priority,
  a.rating,
  a.recruiter_email,
  a.recruiter_name,
  a.role_title,
  a.role_type,
  a.salary_currency,
  a.salary_range_max,
  a.salary_range_min,
  a.source,
  0::bigint AS stage_count,
  a.status,
  a.updated_at,
  CASE
    WHEN a.status IN ('avsluttet', 'trukket') THEN 'ingen'::text
    WHEN a.next_followup_at IS NOT NULL AND a.next_followup_at < CURRENT_DATE THEN 'kritisk'::text
    WHEN a.status = 'søknad_generert'::public.application_status THEN 'høy'::text
    WHEN a.priority = 'høy'::public.priority_level THEN 'høy'::text
    WHEN a.priority = 'lav'::public.priority_level THEN 'lav'::text
    WHEN EXTRACT(EPOCH FROM (timezone('UTC', now()) - a.updated_at)) / 86400 > 21 THEN 'middels'::text
    ELSE 'middels'::text
  END AS urgency_level,
  a.user_id,
  a.work_type
FROM public.applications a;

GRANT SELECT ON public.applications_with_urgency TO authenticated;
GRANT SELECT ON public.applications_with_urgency TO service_role;

-- companies.domain
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS domain text;
CREATE INDEX IF NOT EXISTS idx_companies_domain_lower ON public.companies (lower(domain))
  WHERE domain IS NOT NULL AND length(trim(domain)) > 0;

-- Canonical opportunity MVP
CREATE OR REPLACE FUNCTION public.opportunity_fingerprint(
  p_company text, p_title text, p_location text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT 'fp1:' || md5(
    coalesce(public.normalize_lead_key('', coalesce(p_company,''), coalesce(p_title,''), coalesce(p_location,'')), '')
  );
$$;

CREATE TABLE IF NOT EXISTS public.source_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  source_external_id text NOT NULL,
  listing_id uuid REFERENCES public.job_listings(id) ON DELETE SET NULL,
  raw_url text NOT NULL,
  display_url text NOT NULL,
  title text, company text, location text, description_excerpt text,
  raw_payload jsonb,
  identity_fingerprint text NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_postings_source_external_unique UNIQUE (source, source_external_id)
);
CREATE INDEX IF NOT EXISTS idx_source_postings_fingerprint ON public.source_postings (identity_fingerprint);
CREATE INDEX IF NOT EXISTS idx_source_postings_listing ON public.source_postings (listing_id);

CREATE TABLE IF NOT EXISTS public.canonical_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_fingerprint text NOT NULL,
  display_title text, display_company text, display_location text,
  display_url text NOT NULL,
  primary_source text NOT NULL DEFAULT 'careerjet',
  merge_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canonical_opportunities_fingerprint_unique UNIQUE (identity_fingerprint)
);

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
  ON public.opportunity_source_links (canonical_opportunity_id) WHERE link_role = 'primary';

CREATE TABLE IF NOT EXISTS public.user_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  canonical_opportunity_id uuid NOT NULL REFERENCES public.canonical_opportunities(id) ON DELETE CASCADE,
  identity_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','saved','applied','dismissed')),
  relevance_score numeric(5,2),
  ai_score numeric(5,2),
  ai_reasoning text, ai_match_highlights text, ai_concerns text,
  ai_scored_at timestamptz,
  legacy_listing_status_id uuid REFERENCES public.user_job_listing_status(id) ON DELETE SET NULL,
  legacy_listing_id uuid REFERENCES public.job_listings(id) ON DELETE SET NULL,
  card_title text, card_company text, card_location text, card_salary text,
  card_salary_min numeric, card_salary_max numeric, card_salary_currency text,
  card_display_url text NOT NULL, card_raw_url text NOT NULL,
  card_published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_opportunities_user_canonical_unique UNIQUE (user_id, canonical_opportunity_id)
);
CREATE INDEX IF NOT EXISTS idx_user_opportunities_user_status ON public.user_opportunities (user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_opportunities_fingerprint ON public.user_opportunities (user_id, identity_fingerprint);

CREATE TABLE IF NOT EXISTS public.opportunity_dedup_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  fingerprint_a text NOT NULL,
  fingerprint_b text NOT NULL,
  confidence numeric(5,4),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','merged')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_opportunity_dedup_candidates_user ON public.opportunity_dedup_candidates (user_id, status);

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

ALTER TABLE public.source_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_source_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_dedup_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_dedup_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "source_postings_select_via_user_opportunity" ON public.source_postings;
CREATE POLICY "source_postings_select_via_user_opportunity"
  ON public.source_postings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.opportunity_source_links osl
    JOIN public.user_opportunities uo ON uo.canonical_opportunity_id = osl.canonical_opportunity_id
    WHERE osl.source_posting_id = source_postings.id AND uo.user_id = auth.uid()));

DROP POLICY IF EXISTS "canonical_opportunities_select_via_user" ON public.canonical_opportunities;
CREATE POLICY "canonical_opportunities_select_via_user"
  ON public.canonical_opportunities FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_opportunities uo
    WHERE uo.canonical_opportunity_id = canonical_opportunities.id AND uo.user_id = auth.uid()));

DROP POLICY IF EXISTS "opportunity_source_links_select_via_user" ON public.opportunity_source_links;
CREATE POLICY "opportunity_source_links_select_via_user"
  ON public.opportunity_source_links FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_opportunities uo
    WHERE uo.canonical_opportunity_id = opportunity_source_links.canonical_opportunity_id AND uo.user_id = auth.uid()));

DROP POLICY IF EXISTS "user_opportunities_all_own" ON public.user_opportunities;
CREATE POLICY "user_opportunities_all_own"
  ON public.user_opportunities FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

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

CREATE OR REPLACE FUNCTION public.sync_user_opportunity_ai_from_legacy(p_user_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.user_opportunities uo
  SET ai_score = uj.ai_score, ai_reasoning = uj.ai_reasoning,
      ai_match_highlights = uj.ai_match_highlights, ai_concerns = uj.ai_concerns,
      ai_scored_at = uj.ai_scored_at, updated_at = now()
  FROM public.user_job_listing_status uj
  WHERE uo.user_id = p_user_id AND uo.legacy_listing_status_id = uj.id AND uj.user_id = p_user_id;
$$;
REVOKE ALL ON FUNCTION public.sync_user_opportunity_ai_from_legacy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_user_opportunity_ai_from_legacy(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.opportunity_fingerprint(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.opportunity_fingerprint(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.opportunity_fingerprint(text, text, text) TO service_role;

-- GRANTs for new public tables (patch — eksporten manglet eksplisitte GRANTs)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_opportunities TO authenticated;
GRANT SELECT ON public.canonical_opportunities TO authenticated;
GRANT SELECT ON public.opportunity_source_links TO authenticated;
GRANT SELECT ON public.source_postings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunity_dedup_candidates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunity_dedup_decisions TO authenticated;
GRANT ALL ON public.user_opportunities, public.canonical_opportunities, public.opportunity_source_links, public.source_postings, public.opportunity_dedup_candidates, public.opportunity_dedup_decisions TO service_role;
