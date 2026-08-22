alter table public.next_steps
  add column if not exists activity_type text not null default 'annet',
  add column if not exists status text not null default 'planlagt',
  add column if not exists result_note text,
  add column if not exists activity_scope text not null default 'context',
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.next_steps'::regclass and conname='next_steps_activity_type_check') then
    alter table public.next_steps add constraint next_steps_activity_type_check
      check (activity_type in ('oppfolging','moete','samtale','e_post','soknad','intervju','annet'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.next_steps'::regclass and conname='next_steps_status_check') then
    alter table public.next_steps add constraint next_steps_status_check
      check (status in ('planlagt','pagaar','utfort','avlyst'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.next_steps'::regclass and conname='next_steps_activity_scope_check') then
    alter table public.next_steps add constraint next_steps_activity_scope_check
      check (activity_scope in ('context','personal'));
  end if;
end $$;

update public.next_steps set status = 'utfort' where completed = true and status <> 'utfort';

do $$
begin
  if exists (select 1 from pg_constraint where conrelid='public.next_steps'::regclass and conname='next_steps_owner_check') then
    alter table public.next_steps drop constraint next_steps_owner_check;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.next_steps'::regclass and conname='next_steps_scope_context_check') then
    alter table public.next_steps add constraint next_steps_scope_context_check
      check (
        activity_scope = 'personal'
        or application_id is not null
        or contact_id is not null
        or company_id is not null
        or opportunity_id is not null
      );
  end if;
end $$;

create or replace function public.next_steps_sync_activity_status()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  status_changed boolean := tg_op = 'INSERT' or new.status is distinct from old.status;
  completed_changed boolean := tg_op = 'INSERT' or new.completed is distinct from old.completed;
begin
  if completed_changed and not status_changed then
    if new.completed then
      new.status := 'utfort';
    elsif new.status = 'utfort' then
      new.status := 'planlagt';
    end if;
  end if;

  if new.status = 'utfort' then
    new.completed := true;
    if new.completed_at is null then
      new.completed_at := now();
    end if;
  else
    new.completed := false;
    new.completed_at := null;
  end if;

  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists next_steps_sync_activity_status on public.next_steps;
create trigger next_steps_sync_activity_status
before insert or update on public.next_steps
for each row execute function public.next_steps_sync_activity_status();

create index if not exists next_steps_user_status_due_idx on public.next_steps (user_id, status, due_date);
create index if not exists next_steps_user_contact_idx on public.next_steps (user_id, contact_id) where contact_id is not null;
create index if not exists next_steps_user_opportunity_idx on public.next_steps (user_id, opportunity_id) where opportunity_id is not null;
create index if not exists next_steps_user_company_idx on public.next_steps (user_id, company_id) where company_id is not null;
