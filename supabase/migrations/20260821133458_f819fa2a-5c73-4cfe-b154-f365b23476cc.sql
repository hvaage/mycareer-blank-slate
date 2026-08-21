select public.linkedin_import_manual_retry('886529ce-edff-49c1-9dc4-a24e6e617f0b'::uuid, '8103b452-0a27-46b0-a204-e2d9db34ec22'::uuid) as attempt_id;
update public.linkedin_import_attempts
set cursor_json = jsonb_build_object('fileIndex', 0, 'stagedRecords', 0, 'reconciled', false)
where linkedin_import_id = '886529ce-edff-49c1-9dc4-a24e6e617f0b'
  and status in ('queued','running');