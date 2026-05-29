-- chunk_b1: 20260507171850 → 20260508083900
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS linkedin_id text,
  ADD COLUMN IF NOT EXISTS linkedin_headline text,
  ADD COLUMN IF NOT EXISTS linkedin_vanity_url text,
  ADD COLUMN IF NOT EXISTS linkedin_picture_url text,
  ADD COLUMN IF NOT EXISTS linkedin_connected_at timestamptz;

alter table public.profiles
  add column if not exists onboarding_completed boolean default false,
  add column if not exists onboarding_step integer,
  add column if not exists onboarding_started_at timestamptz,
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists full_name text,
  add column if not exists phone text,
  add column if not exists target_role text;

insert into storage.buckets (id, name, public)
values ('cv-uploads', 'cv-uploads', false)
on conflict (id) do nothing;

drop policy if exists "cv-uploads users select own" on storage.objects;
drop policy if exists "cv-uploads users insert own" on storage.objects;
drop policy if exists "cv-uploads users update own" on storage.objects;
drop policy if exists "cv-uploads users delete own" on storage.objects;

create policy "cv-uploads users select own" on storage.objects for select to authenticated
  using (bucket_id = 'cv-uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "cv-uploads users insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'cv-uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "cv-uploads users update own" on storage.objects for update to authenticated
  using (bucket_id = 'cv-uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "cv-uploads users delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'cv-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create table if not exists public.job_listings (
  id uuid primary key default gen_random_uuid(),
  external_id text unique not null,
  source text not null default 'careerjet',
  title text, employer text, description text, location text,
  municipality text, municipality_code text,
  salary text, salary_min numeric, salary_max numeric, salary_currency text,
  published_at timestamptz, expires_at timestamptz, source_url text,
  raw_data jsonb, is_expired boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
GRANT SELECT ON public.job_listings TO authenticated;
GRANT ALL ON public.job_listings TO service_role;
create index if not exists job_listings_published_idx on public.job_listings (published_at desc);
create index if not exists job_listings_location_idx on public.job_listings (lower(location));
alter table public.job_listings enable row level security;
drop policy if exists "Authenticated users can read listings" on public.job_listings;
create policy "Authenticated users can read listings" on public.job_listings for select to authenticated using (true);

create table if not exists public.user_job_listing_status (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  listing_id uuid references public.job_listings(id) on delete cascade not null,
  status text not null default 'new',
  relevance_score numeric(5,2) default 0,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique(user_id, listing_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_job_listing_status TO authenticated;
GRANT ALL ON public.user_job_listing_status TO service_role;
alter table public.user_job_listing_status enable row level security;
drop policy if exists "Users manage own listing status" on public.user_job_listing_status;
create policy "Users manage own listing status" on public.user_job_listing_status for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists user_listing_status_idx on public.user_job_listing_status (user_id, status);
create index if not exists user_listing_score_idx on public.user_job_listing_status (user_id, relevance_score desc);

alter table public.profiles
  add column if not exists preferred_locations text[] default '{}',
  add column if not exists job_search_keywords text,
  add column if not exists listings_last_fetched_at timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS given_name text,
  ADD COLUMN IF NOT EXISTS linkedin_email_verified boolean,
  ADD COLUMN IF NOT EXISTS linkedin_locale text;

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS ai_score smallint,
  ADD COLUMN IF NOT EXISTS ai_reasoning text,
  ADD COLUMN IF NOT EXISTS ai_match_highlights text,
  ADD COLUMN IF NOT EXISTS ai_concerns text,
  ADD COLUMN IF NOT EXISTS salary_text text,
  ADD COLUMN IF NOT EXISTS posted_text text,
  ADD COLUMN IF NOT EXISTS raw_snippet text,
  ADD COLUMN IF NOT EXISTS source_subject text,
  ADD COLUMN IF NOT EXISTS source_email_from text,
  ADD COLUMN IF NOT EXISTS cv_used_path text,
  ADD COLUMN IF NOT EXISTS cv_used_language text,
  ADD COLUMN IF NOT EXISTS letter_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS letter_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_followup_at date,
  ADD COLUMN IF NOT EXISTS followup_notes text,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

alter table public.companies
  add column if not exists ai_dimension_notes jsonb,
  add column if not exists financials jsonb;

create table if not exists public.application_process_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, application_id uuid not null, company_id uuid,
  q1_acknowledgment smallint check (q1_acknowledgment between 1 and 5),
  q2_communication smallint check (q2_communication between 1 and 5),
  q3_respect smallint check (q3_respect between 1 and 5),
  q4_feedback smallint check (q4_feedback between 1 and 5),
  q5_kept_promises smallint check (q5_kept_promises between 1 and 5),
  q6_would_recommend smallint check (q6_would_recommend between 1 and 5),
  comments text,
  created_at timestamptz not null default now(),
  unique (user_id, application_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.application_process_ratings TO authenticated;
GRANT ALL ON public.application_process_ratings TO service_role;
alter table public.application_process_ratings enable row level security;
drop policy if exists "users own process ratings" on public.application_process_ratings;
create policy "users own process ratings" on public.application_process_ratings for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.companies
  add column if not exists agg_process_q1 numeric, add column if not exists agg_process_q2 numeric,
  add column if not exists agg_process_q3 numeric, add column if not exists agg_process_q4 numeric,
  add column if not exists agg_process_q5 numeric, add column if not exists agg_process_q6 numeric,
  add column if not exists agg_process_overall numeric,
  add column if not exists agg_process_count integer not null default 0;

create or replace function public.refresh_company_process_aggregate(p_company_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.companies set
    agg_process_q1 = (select round(avg(q1_acknowledgment)::numeric, 1) from public.application_process_ratings where company_id = p_company_id),
    agg_process_q2 = (select round(avg(q2_communication)::numeric, 1) from public.application_process_ratings where company_id = p_company_id),
    agg_process_q3 = (select round(avg(q3_respect)::numeric, 1) from public.application_process_ratings where company_id = p_company_id),
    agg_process_q4 = (select round(avg(q4_feedback)::numeric, 1) from public.application_process_ratings where company_id = p_company_id),
    agg_process_q5 = (select round(avg(q5_kept_promises)::numeric, 1) from public.application_process_ratings where company_id = p_company_id),
    agg_process_q6 = (select round(avg(q6_would_recommend)::numeric, 1) from public.application_process_ratings where company_id = p_company_id),
    agg_process_overall = (select round(avg((coalesce(q1_acknowledgment,0)+coalesce(q2_communication,0)+coalesce(q3_respect,0)+coalesce(q4_feedback,0)+coalesce(q5_kept_promises,0)+coalesce(q6_would_recommend,0))/6.0)::numeric, 1) from public.application_process_ratings where company_id = p_company_id),
    agg_process_count = (select count(*) from public.application_process_ratings where company_id = p_company_id),
    updated_at = now()
  where id = p_company_id;
end; $$;

CREATE TABLE IF NOT EXISTS public.lead_dedupe_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, dedupe_key text NOT NULL, source text NOT NULL,
  source_priority smallint NOT NULL DEFAULT 1,
  ref_table text, ref_id uuid,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_dedupe_keys TO authenticated;
GRANT ALL ON public.lead_dedupe_keys TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_dedupe_keys_user_key ON public.lead_dedupe_keys(user_id, dedupe_key);
ALTER TABLE public.lead_dedupe_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users own dedupe keys" ON public.lead_dedupe_keys;
CREATE POLICY "users own dedupe keys" ON public.lead_dedupe_keys FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_lead_dedupe_keys_updated_at ON public.lead_dedupe_keys;
CREATE TRIGGER trg_lead_dedupe_keys_updated_at BEFORE UPDATE ON public.lead_dedupe_keys
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.normalize_lead_key(p_url text, p_company text, p_title text, p_location text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE u text;
BEGIN
  IF p_url IS NOT NULL AND length(trim(p_url)) > 0 THEN
    u := lower(trim(p_url));
    u := regexp_replace(u, '^https?://', '');
    u := regexp_replace(u, '[?#].*$', '');
    u := regexp_replace(u, '/+$', '');
    u := regexp_replace(u, '^www\.', '');
    RETURN 'url:' || u;
  END IF;
  RETURN 'cmp:' ||
    coalesce(lower(regexp_replace(p_company, '\s+', ' ', 'g')), '') || '|' ||
    coalesce(lower(regexp_replace(p_title,   '\s+', ' ', 'g')), '') || '|' ||
    coalesce(lower(regexp_replace(p_location,'\s+', ' ', 'g')), '');
END; $$;

CREATE OR REPLACE FUNCTION public.register_lead(p_user_id uuid, p_source text, p_priority smallint, p_dedupe_key text, p_ref_table text, p_ref_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing public.lead_dedupe_keys%ROWTYPE;
BEGIN
  SELECT * INTO existing FROM public.lead_dedupe_keys WHERE user_id = p_user_id AND dedupe_key = p_dedupe_key LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO public.lead_dedupe_keys(user_id, dedupe_key, source, source_priority, ref_table, ref_id, status)
    VALUES (p_user_id, p_dedupe_key, p_source, p_priority, p_ref_table, p_ref_id, 'active');
    RETURN true;
  END IF;
  IF existing.status IN ('dismissed','deleted','promoted') THEN RETURN false; END IF;
  IF p_priority > existing.source_priority THEN
    UPDATE public.lead_dedupe_keys SET source = p_source, source_priority = p_priority,
           ref_table = p_ref_table, ref_id = p_ref_id, updated_at = now()
     WHERE id = existing.id;
    RETURN true;
  END IF;
  RETURN false;
END; $$;

CREATE OR REPLACE FUNCTION public.prune_stale_leads(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.job_leads WHERE user_id = p_user_id AND promoted_application_id IS NULL
    AND status IN ('ny','avvist','arkivert') AND created_at < now() - interval '30 days';
  DELETE FROM public.user_job_listing_status WHERE user_id = p_user_id
    AND status IN ('new','dismissed') AND updated_at < now() - interval '30 days';
  DELETE FROM public.lead_dedupe_keys WHERE user_id = p_user_id AND status = 'active'
    AND updated_at < now() - interval '30 days'
    AND NOT EXISTS (SELECT 1 FROM public.job_leads jl WHERE jl.user_id = p_user_id AND lead_dedupe_keys.ref_table = 'job_leads' AND jl.id = lead_dedupe_keys.ref_id)
    AND NOT EXISTS (SELECT 1 FROM public.user_job_listing_status us WHERE us.user_id = p_user_id AND lead_dedupe_keys.ref_table = 'user_job_listing_status' AND us.id = lead_dedupe_keys.ref_id)
    AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.user_id = p_user_id AND lead_dedupe_keys.ref_table = 'applications' AND a.id = lead_dedupe_keys.ref_id);
END; $$;

REVOKE ALL ON FUNCTION public.register_lead(uuid, text, smallint, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_lead(uuid, text, smallint, text, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.prune_stale_leads(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prune_stale_leads(uuid) TO authenticated, service_role;