
-- 1. Hard-guard unique index for register_lead's ON CONFLICT semantics
CREATE UNIQUE INDEX IF NOT EXISTS lead_dedupe_keys_user_key_uniq
  ON public.lead_dedupe_keys(user_id, dedupe_key);

-- 2. Extend prune_stale_leads to also clear in-table duplicates
CREATE OR REPLACE FUNCTION public.prune_stale_leads(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Old: stale rows
  DELETE FROM public.job_leads
   WHERE user_id = p_user_id
     AND promoted_application_id IS NULL
     AND status IN ('ny','avvist','arkivert')
     AND created_at < now() - interval '30 days';

  DELETE FROM public.user_job_listing_status
   WHERE user_id = p_user_id
     AND status IN ('new','dismissed')
     AND updated_at < now() - interval '30 days';

  -- New: collapse duplicate job_leads (same normalized key); keep promoted, then oldest
  WITH ranked AS (
    SELECT id,
      row_number() OVER (
        PARTITION BY user_id, public.normalize_lead_key(
          coalesce(job_url,''), coalesce(company,''),
          coalesce(title,''),  coalesce(location,'')
        )
        ORDER BY (promoted_application_id IS NOT NULL) DESC, created_at ASC
      ) AS rn
    FROM public.job_leads
    WHERE user_id = p_user_id
  )
  DELETE FROM public.job_leads jl
   USING ranked r
   WHERE jl.id = r.id AND r.rn > 1;

  -- Old: dedupe key cleanup
  DELETE FROM public.lead_dedupe_keys
   WHERE user_id = p_user_id
     AND status = 'active'
     AND updated_at < now() - interval '30 days'
     AND NOT EXISTS (
       SELECT 1 FROM public.job_leads jl
        WHERE jl.user_id = p_user_id
          AND lead_dedupe_keys.ref_table = 'job_leads'
          AND jl.id = lead_dedupe_keys.ref_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.user_job_listing_status us
        WHERE us.user_id = p_user_id
          AND lead_dedupe_keys.ref_table = 'user_job_listing_status'
          AND us.id = lead_dedupe_keys.ref_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.applications a
        WHERE a.user_id = p_user_id
          AND lead_dedupe_keys.ref_table = 'applications'
          AND a.id = lead_dedupe_keys.ref_id
     );
END;
$function$;
