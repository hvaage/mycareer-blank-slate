ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS company_name text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS mime_type text;

-- Fix INSERT policy to require user folder
DROP POLICY IF EXISTS users_upload_own_documents ON storage.objects;
CREATE POLICY users_upload_own_documents ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'job-documents' AND (auth.uid())::text = (storage.foldername(name))[1]);