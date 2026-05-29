-- job_listings
create table if not exists public.job_listings (
  id              uuid primary key default gen_random_uuid(),
  external_id     text unique not null,
  source          text not null default 'careerjet',
  title           text,
  employer        text,
  description     text,
  location        text,
  municipality    text,
  municipality_code text,
  salary          text,
  salary_min      numeric,
  salary_max      numeric,
  salary_currency text,
  published_at    timestamptz,
  expires_at      timestamptz,
  source_url      text,
  raw_data        jsonb,
  is_expired      boolean default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists job_listings_published_idx on public.job_listings (published_at desc);
create index if not exists job_listings_location_idx on public.job_listings (lower(location));

alter table public.job_listings enable row level security;

drop policy if exists "Authenticated users can read listings" on public.job_listings;
create policy "Authenticated users can read listings"
  on public.job_listings for select
  to authenticated
  using (true);

-- user_job_listing_status
create table if not exists public.user_job_listing_status (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  listing_id      uuid references public.job_listings(id) on delete cascade not null,
  status          text not null default 'new',
  relevance_score numeric(5,2) default 0,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique(user_id, listing_id)
);

alter table public.user_job_listing_status enable row level security;

drop policy if exists "Users manage own listing status" on public.user_job_listing_status;
create policy "Users manage own listing status"
  on public.user_job_listing_status for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists user_listing_status_idx
  on public.user_job_listing_status (user_id, status);
create index if not exists user_listing_score_idx
  on public.user_job_listing_status (user_id, relevance_score desc);

-- profiles additions
alter table public.profiles
  add column if not exists preferred_locations   text[] default '{}',
  add column if not exists job_search_keywords   text,
  add column if not exists listings_last_fetched_at timestamptz;