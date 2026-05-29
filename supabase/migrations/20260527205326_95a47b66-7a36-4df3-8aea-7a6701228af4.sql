
-- 1. Fix SECURITY DEFINER view
ALTER VIEW public.applications_with_urgency SET (security_invoker = true);

-- 2. Add search_path to trigger/internal functions
ALTER FUNCTION public.log_application_changes() SET search_path = public;
ALTER FUNCTION public.log_application_created() SET search_path = public;
ALTER FUNCTION public.log_document_added() SET search_path = public;
ALTER FUNCTION public.log_meeting_added() SET search_path = public;
ALTER FUNCTION public.log_stage_added() SET search_path = public;
ALTER FUNCTION public.log_step_completed() SET search_path = public;
ALTER FUNCTION public.refresh_company_aggregate(uuid) SET search_path = public;
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.update_updated_at() SET search_path = public;

-- 3. Revoke EXECUTE on trigger-only functions from anon/authenticated/public
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_application_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_application_created() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_document_added() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_meeting_added() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_stage_added() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_step_completed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prune_stale_leads(uuid) FROM PUBLIC, anon, authenticated;

-- 4. Add UPDATE storage policy for job-documents bucket
CREATE POLICY "users_update_own_documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'job-documents' AND auth.uid()::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'job-documents' AND auth.uid()::text = (storage.foldername(name))[1]);
