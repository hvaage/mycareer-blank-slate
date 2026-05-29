-- applications_with_urgency — read model for dashboard / application list.
-- Exposes the column set expected by src/integrations/supabase/types.ts (Views.applications_with_urgency)
-- and src/lib/queries/applications.ts (select *).
--
-- MVP: urgency_level is deterministic from status, priority, next_followup_at, and staleness.
-- document_count comes from public.documents; meeting_count / open_tasks / stage_count are 0
-- until legacy FKs or missing tables (interviews → job_applications, next_steps) are aligned in migrations.

CREATE OR REPLACE VIEW public.applications_with_urgency
WITH (security_invoker = true)
AS
SELECT
  a.applied_date,
  a.available_from,
  a.company_linkedin,
  a.company_name,
  a.company_size,
  a.company_website,
  a.contact_email,
  a.contact_linkedin,
  a.contact_name,
  a.created_at,
  CASE
    WHEN a.applied_date IS NOT NULL THEN (CURRENT_DATE - a.applied_date)::integer
  END AS days_since_applied,
  GREATEST(
    0,
    FLOOR(EXTRACT(EPOCH FROM (timezone('UTC', now()) - a.updated_at)) / 86400)::integer
  ) AS days_since_update,
  COALESCE(
    (SELECT COUNT(*)::bigint FROM public.documents d WHERE d.application_id = a.id),
    0::bigint
  ) AS document_count,
  a.id,
  a.industry,
  a.internal_assessment,
  a.is_starred,
  a.job_url,
  a.location,
  0::bigint AS meeting_count,
  a.notes,
  0::bigint AS open_tasks,
  a.priority,
  a.rating,
  a.recruiter_email,
  a.recruiter_name,
  a.role_title,
  a.role_type,
  a.salary_currency,
  a.salary_range_max,
  a.salary_range_min,
  a.source,
  0::bigint AS stage_count,
  a.status,
  a.updated_at,
  CASE
    WHEN a.status IN ('avsluttet', 'trukket') THEN 'ingen'::text
    WHEN a.next_followup_at IS NOT NULL AND a.next_followup_at < CURRENT_DATE THEN 'kritisk'::text
    WHEN a.status = 'søknad_generert'::public.application_status THEN 'høy'::text
    WHEN a.priority = 'høy'::public.priority_level THEN 'høy'::text
    WHEN a.priority = 'lav'::public.priority_level THEN 'lav'::text
    WHEN EXTRACT(EPOCH FROM (timezone('UTC', now()) - a.updated_at)) / 86400 > 21 THEN 'middels'::text
    ELSE 'middels'::text
  END AS urgency_level,
  a.user_id,
  a.work_type
FROM public.applications a;

COMMENT ON VIEW public.applications_with_urgency IS
  'Dashboard list: applications plus urgency_level and simple aggregates. MVP: open_tasks/stage_count/meeting_count are 0.';

GRANT SELECT ON public.applications_with_urgency TO authenticated;
GRANT SELECT ON public.applications_with_urgency TO service_role;
