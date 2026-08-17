create table public.cv_atomization_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cv_import_id uuid not null references public.cv_imports(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','complete','partial','failed')),
  phase text not null default 'plan' check (phase in ('plan','appointments','block_content','consolidate','done')),
  pipeline text not null default 'hierarchical',
  profile_key text not null default 'v2_1',
  input_signature text not null,
  correlation_id uuid not null,
  model_run_id uuid,
  batch_id uuid,
  regenerate boolean not null default false,
  metrics jsonb not null default '{}'::jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index cv_atomization_jobs_user_import_idx on public.cv_atomization_jobs (user_id, cv_import_id, created_at desc);

grant select on public.cv_atomization_jobs to authenticated;
grant all on public.cv_atomization_jobs to service_role;
alter table public.cv_atomization_jobs enable row level security;
create policy "cv_atomization_jobs_select_own" on public.cv_atomization_jobs
  for select to authenticated using (user_id = auth.uid());

create table public.cv_atomization_job_blocks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.cv_atomization_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  phase text not null check (phase in ('appointments','block_content','consolidate')),
  block_key text not null,
  label text not null,
  sort_order integer not null default 0,
  status text not null default 'queued' check (status in ('queued','running','complete','needs_review','failed')),
  span_ids jsonb not null default '[]'::jsonb,
  sub_batch_signature text,
  result jsonb,
  metrics jsonb not null default '{}'::jsonb,
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, phase, block_key)
);

create index cv_atomization_job_blocks_job_idx on public.cv_atomization_job_blocks (job_id, sort_order);

grant select on public.cv_atomization_job_blocks to authenticated;
grant all on public.cv_atomization_job_blocks to service_role;
alter table public.cv_atomization_job_blocks enable row level security;
create policy "cv_atomization_job_blocks_select_own" on public.cv_atomization_job_blocks
  for select to authenticated using (user_id = auth.uid());

create trigger cv_atomization_jobs_updated_at before update on public.cv_atomization_jobs
  for each row execute function public.update_updated_at_column();
create trigger cv_atomization_job_blocks_updated_at before update on public.cv_atomization_job_blocks
  for each row execute function public.update_updated_at_column();