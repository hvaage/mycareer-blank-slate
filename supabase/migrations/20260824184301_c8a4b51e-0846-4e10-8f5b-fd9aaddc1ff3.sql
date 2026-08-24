-- 1. Allow job_leads rows in job_match_evaluations
ALTER TABLE public.job_match_evaluations DROP CONSTRAINT IF EXISTS job_match_evaluations_row_kind_check;
ALTER TABLE public.job_match_evaluations DROP CONSTRAINT IF EXISTS job_match_evaluations_row_ref_chk;

ALTER TABLE public.job_match_evaluations
  ADD CONSTRAINT job_match_evaluations_row_kind_check
  CHECK (row_kind = ANY (ARRAY['canonical'::text, 'legacy'::text, 'job_leads'::text]));

ALTER TABLE public.job_match_evaluations
  ADD CONSTRAINT job_match_evaluations_row_ref_chk
  CHECK (
    (row_kind = 'canonical' AND user_opportunity_id IS NOT NULL)
    OR (row_kind = 'legacy' AND listing_status_id IS NOT NULL)
    OR (row_kind = 'job_leads' AND job_lead_id IS NOT NULL)
  );

-- 2. Restore missing Data API grants on public tables (RLS unchanged)
DO $$
DECLARE
    tbl record;
    has_priv boolean;
BEGIN
    FOR tbl IN
        SELECT c.relname AS table_name
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind = 'r'
           AND n.nspname = 'public'
    LOOP
        SELECT EXISTS (
            SELECT 1 FROM information_schema.role_table_grants
             WHERE grantee = 'authenticated' AND table_schema = 'public' AND table_name = tbl.table_name
               AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
        ) INTO has_priv;
        IF NOT has_priv THEN
            EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', tbl.table_name);
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.role_table_grants
             WHERE grantee = 'service_role' AND table_schema = 'public' AND table_name = tbl.table_name
               AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
        ) INTO has_priv;
        IF NOT has_priv THEN
            EXECUTE format('GRANT ALL ON public.%I TO service_role', tbl.table_name);
        END IF;
    END LOOP;
END;
$$;

-- 3. has_role must be callable while RLS policies are evaluated, including anon requests
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon, authenticated, service_role;
GRANT USAGE ON TYPE public.app_role TO anon, authenticated, service_role;