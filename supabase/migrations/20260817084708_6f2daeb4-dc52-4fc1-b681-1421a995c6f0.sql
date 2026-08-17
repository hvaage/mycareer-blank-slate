alter table public.cv_atomization_jobs
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists attempts integer not null default 0,
  add column if not exists last_reaped_at timestamptz;

create index if not exists cv_atomization_jobs_runnable_idx
  on public.cv_atomization_jobs (status, lease_expires_at)
  where status in ('queued','running');

-- Hent neste kjørbare jobb og ta lås. Bare bakgrunnsarbeideren kan kalle denne.
create or replace function public.internal_cv_atomization_claim(
  p_owner text,
  p_lease_seconds integer default 120,
  p_job_id uuid default null,
  p_max_attempts integer default 6
)
returns table (
  job_id uuid,
  user_id uuid,
  cv_import_id uuid,
  attempts integer,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select j.id into v_id
  from public.cv_atomization_jobs j
  where j.status in ('queued','running')
    and (p_job_id is null or j.id = p_job_id)
    and (j.lease_expires_at is null or j.lease_expires_at < now())
    and j.attempts < p_max_attempts
  order by j.created_at asc
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  update public.cv_atomization_jobs j
  set status = 'running',
      lease_owner = p_owner,
      lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
      heartbeat_at = now(),
      attempts = j.attempts + 1
  where j.id = v_id;

  return query
  select j.id, j.user_id, j.cv_import_id, j.attempts, j.status
  from public.cv_atomization_jobs j
  where j.id = v_id;
end;
$$;

create or replace function public.internal_cv_atomization_heartbeat(
  p_job_id uuid,
  p_owner text,
  p_lease_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.cv_atomization_jobs
  set lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
      heartbeat_at = now()
  where id = p_job_id
    and lease_owner = p_owner
    and status in ('queued','running');
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

create or replace function public.internal_cv_atomization_release(
  p_job_id uuid,
  p_owner text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.cv_atomization_jobs
  set lease_owner = null,
      lease_expires_at = null
  where id = p_job_id
    and lease_owner = p_owner;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- Rydder opp jobber og delblokker som stoppet opp (f.eks. lukket nettleser).
create or replace function public.internal_cv_atomization_reap(
  p_max_attempts integer default 6
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jobs integer := 0;
  v_blocks integer := 0;
  v_failed integer := 0;
begin
  with stale as (
    select id from public.cv_atomization_jobs
    where status in ('queued','running')
      and lease_expires_at is not null
      and lease_expires_at < now()
  ), reset_blocks as (
    update public.cv_atomization_job_blocks b
    set status = 'queued', started_at = null
    where b.status = 'running'
      and b.job_id in (select id from stale)
    returning 1
  )
  select count(*) into v_blocks from reset_blocks;

  update public.cv_atomization_jobs
  set status = 'queued',
      lease_owner = null,
      lease_expires_at = null,
      last_reaped_at = now()
  where status in ('queued','running')
    and lease_expires_at is not null
    and lease_expires_at < now()
    and attempts < p_max_attempts;
  get diagnostics v_jobs = row_count;

  update public.cv_atomization_jobs
  set status = 'failed',
      error_code = coalesce(error_code, 'lease_exhausted'),
      lease_owner = null,
      lease_expires_at = null,
      finished_at = coalesce(finished_at, now()),
      last_reaped_at = now()
  where status in ('queued','running')
    and attempts >= p_max_attempts
    and (lease_expires_at is null or lease_expires_at < now());
  get diagnostics v_failed = row_count;

  return jsonb_build_object('requeued_jobs', v_jobs, 'requeued_blocks', v_blocks, 'failed_jobs', v_failed);
end;
$$;

revoke all on function public.internal_cv_atomization_claim(text, integer, uuid, integer) from public, anon, authenticated;
revoke all on function public.internal_cv_atomization_heartbeat(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.internal_cv_atomization_release(uuid, text) from public, anon, authenticated;
revoke all on function public.internal_cv_atomization_reap(integer) from public, anon, authenticated;
grant execute on function public.internal_cv_atomization_claim(text, integer, uuid, integer) to service_role;
grant execute on function public.internal_cv_atomization_heartbeat(uuid, text, integer) to service_role;
grant execute on function public.internal_cv_atomization_release(uuid, text) to service_role;
grant execute on function public.internal_cv_atomization_reap(integer) to service_role;