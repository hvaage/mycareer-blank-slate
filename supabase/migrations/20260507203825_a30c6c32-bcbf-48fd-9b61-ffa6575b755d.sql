
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

create policy "cv-uploads users select own"
on storage.objects for select
to authenticated
using (bucket_id = 'cv-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "cv-uploads users insert own"
on storage.objects for insert
to authenticated
with check (bucket_id = 'cv-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "cv-uploads users update own"
on storage.objects for update
to authenticated
using (bucket_id = 'cv-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "cv-uploads users delete own"
on storage.objects for delete
to authenticated
using (bucket_id = 'cv-uploads' and (storage.foldername(name))[1] = auth.uid()::text);
