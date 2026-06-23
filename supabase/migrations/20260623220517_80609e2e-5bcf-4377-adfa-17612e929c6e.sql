
-- 1) leads: add explicit service-role-only policies (RLS already enabled, zero policies)
CREATE POLICY "Service role can read leads" ON public.leads
  FOR SELECT TO public USING (auth.role() = 'service_role');
CREATE POLICY "Service role can insert leads" ON public.leads
  FOR INSERT TO public WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role can update leads" ON public.leads
  FOR UPDATE TO public USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role can delete leads" ON public.leads
  FOR DELETE TO public USING (auth.role() = 'service_role');

-- 2) opportunity_dedup_candidates / decisions: remove null-user_id exposure
DROP POLICY IF EXISTS opportunity_dedup_candidates_select ON public.opportunity_dedup_candidates;
CREATE POLICY opportunity_dedup_candidates_select ON public.opportunity_dedup_candidates
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS opportunity_dedup_decisions_select ON public.opportunity_dedup_decisions;
CREATE POLICY opportunity_dedup_decisions_select ON public.opportunity_dedup_decisions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 3) result_access_signups: tighten INSERT (was WITH CHECK true)
DROP POLICY IF EXISTS "Anyone can insert access signup" ON public.result_access_signups;
CREATE POLICY "Anyone can insert access signup" ON public.result_access_signups
  FOR INSERT TO public
  WITH CHECK (email IS NOT NULL AND email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' AND length(email) <= 254);

-- 4) Security definer view: switch to security_invoker
ALTER VIEW public.employer_search_v1 SET (security_invoker = true);

-- 5) Set fixed search_path on the two helpers missing it
ALTER FUNCTION public._careerjet_is_visible(text, uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public._careerjet_norm_text(text) SET search_path = public, pg_temp;

-- 6) Lock down internal SECURITY DEFINER functions: revoke from anon/authenticated/PUBLIC.
-- Keep user-facing RPCs (has_role, get_user_employers, get_employer_analysis_*,
-- search_employers, ensure_company_for_employer, list_user_*, set/reset weights,
-- review_employer_analysis_model_run, register_lead, prune_stale_leads) callable
-- by authenticated; revoke their anon access where present.

-- Internal: revoke from everyone except service_role / postgres
REVOKE EXECUTE ON FUNCTION public.careerjet_identity_repair_progress() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.careerjet_identity_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.careerjet_sync_count_missing_raw_payload() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.careerjet_sync_distinct_external_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.careerjet_sync_duplicate_external_ids() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.careerjet_sync_external_id_prefix_counts() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.careerjet_sync_last_seen_stats() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.careerjet_sync_term_coverage() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.careerjet_sync_vault_has_secret() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_careerjet_sync_cron_info() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_nav_repair_cron_info() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_nav_sync_cron_info() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.link_canonical_to_source(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.list_regnskap_cron_runs(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_stale_careerjet_postings(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.nav_sync_count_missing_nav_detail() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.nav_sync_distinct_external_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.nav_sync_duplicate_external_ids() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.nav_sync_repair_progress() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.nav_sync_target_cursor() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.nav_sync_target_inventory() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.nav_sync_vault_has_secret() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.nav_sync_vault_secret_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.nav_target_lease_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_company_aggregate(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_company_process_aggregate(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_user_opportunity_ai_from_legacy(uuid) FROM PUBLIC, anon, authenticated;

-- User-facing: revoke anon access where currently present (keep authenticated)
REVOKE EXECUTE ON FUNCTION public.get_employer_analysis_view(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.search_employers(text, text, text, text, integer, integer, numeric, numeric, text, integer, integer, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_user_careerjet_leads(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_user_job_opportunities(text, text) FROM PUBLIC, anon;
