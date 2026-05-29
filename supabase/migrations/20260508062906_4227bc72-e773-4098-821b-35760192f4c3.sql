
alter table public.companies
  add column if not exists ai_dimension_notes jsonb,
  add column if not exists financials jsonb;

create table if not exists public.application_process_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  application_id uuid not null,
  company_id uuid,
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

alter table public.application_process_ratings enable row level security;

create policy "users own process ratings"
  on public.application_process_ratings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.companies
  add column if not exists agg_process_q1 numeric,
  add column if not exists agg_process_q2 numeric,
  add column if not exists agg_process_q3 numeric,
  add column if not exists agg_process_q4 numeric,
  add column if not exists agg_process_q5 numeric,
  add column if not exists agg_process_q6 numeric,
  add column if not exists agg_process_overall numeric,
  add column if not exists agg_process_count integer not null default 0;

create or replace function public.refresh_company_process_aggregate(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
end;
$$;
