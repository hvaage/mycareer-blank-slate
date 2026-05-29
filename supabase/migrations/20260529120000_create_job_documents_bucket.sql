-- My Career Builder migration patch.
-- The export references storage bucket "job-documents" in policies, but did not create it.
-- Keep bucket private and scope direct object access to the user's top-level folder.

insert into storage.buckets (id, name, public)
values ('job-documents', 'job-documents', false)
on conflict (id) do nothing;

drop policy if exists users_select_own_documents on storage.objects;
create policy users_select_own_documents
on storage.objects
for select
to authenticated
using (
  bucket_id = 'job-documents'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists users_upload_own_documents on storage.objects;
create policy users_upload_own_documents
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'job-documents'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists users_update_own_documents on storage.objects;
create policy users_update_own_documents
on storage.objects
for update
to authenticated
using (
  bucket_id = 'job-documents'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'job-documents'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists users_delete_own_documents on storage.objects;
create policy users_delete_own_documents
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'job-documents'
  and auth.uid()::text = (storage.foldername(name))[1]
);

