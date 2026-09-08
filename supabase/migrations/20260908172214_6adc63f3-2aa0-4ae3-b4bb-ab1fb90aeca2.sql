-- harden_ai_integration_grants
REVOKE ALL PRIVILEGES ON TABLE public.ai_integrations FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.ai_integration_setup_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.automation_preferences FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.automation_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.career_log_suggestions FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.ai_integrations TO service_role;
GRANT ALL ON public.ai_integration_setup_sessions TO service_role;
GRANT ALL ON public.automation_preferences TO service_role;
GRANT ALL ON public.automation_runs TO service_role;
GRANT ALL ON public.career_log_suggestions TO service_role;

GRANT SELECT ON public.ai_integrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_preferences TO authenticated;
GRANT SELECT ON public.automation_runs TO authenticated;
GRANT SELECT ON public.career_log_suggestions TO authenticated;
GRANT UPDATE (status, title, summary, occurred_on, reviewed_at)
  ON public.career_log_suggestions TO authenticated;