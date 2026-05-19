
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  email text not null unique,
  linkedin_url text not null,
  role text,
  consent_privacy boolean not null default false,
  consent_marketing boolean not null default false,
  source text not null default 'selskapsanalyse',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

alter table public.leads enable row level security;

-- Allow anonymous and authenticated inserts (form submissions)
create policy "Anyone can submit a lead"
  on public.leads for insert
  to anon, authenticated
  with check (true);

-- No select/update/delete policies: only service role (server) can read/update
