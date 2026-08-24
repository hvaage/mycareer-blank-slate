-- =====================================================================
-- 0) Versjonskontroll av e-postkøfunksjonene (uendret atferd)
--    Hentet ordrett fra pg_get_functiondef. De ble opprettet direkte mot
--    databasen av e-postinfrastrukturen og fantes ikke i migrasjonssporet.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.email_queue_dispatch()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pgmq.q_auth_emails)
     AND NOT EXISTS (SELECT 1 FROM pgmq.q_transactional_emails) THEN
    BEGIN
      -- Serialize disarm against email_queue_wake on a shared advisory lock, then
      -- re-read under it: an enqueue racing the unschedule either committed (we
      -- see its row and leave the cron) or waits and re-arms after we commit.
      PERFORM pg_catalog.pg_advisory_xact_lock(7700000000000001);
      IF EXISTS (SELECT 1 FROM pgmq.q_auth_emails)
         OR EXISTS (SELECT 1 FROM pgmq.q_transactional_emails) THEN
        RETURN;
      END IF;
      PERFORM cron.unschedule('process-email-queue');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'email_queue_dispatch: cron unschedule failed: %', SQLERRM;
    END;
    RETURN;
  END IF;

  IF (SELECT retry_after_until FROM public.email_send_state WHERE id = 1) > now() THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://project--4cf3d398-92d8-4618-910c-9be52ac97cf5.lovable.app/lovable/email/queue/process',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Lovable-Context', 'cron',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'
      )
    ),
    body := '{}'::jsonb
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.email_queue_wake()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Runs inside the enqueue transaction; the outer handler guarantees nothing
  -- below can roll back the customer's email. Shared advisory lock serializes
  -- arming against email_queue_dispatch's disarm.
  PERFORM pg_catalog.pg_advisory_xact_lock(7700000000000001);
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-email-queue') THEN
    BEGIN
      PERFORM cron.schedule('process-email-queue', '5 seconds', $cron$ SELECT public.email_queue_dispatch(); $cron$);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'email_queue_wake: cron schedule failed: %', SQLERRM;
    END;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := 'https://project--4cf3d398-92d8-4618-910c-9be52ac97cf5.lovable.app/lovable/email/queue/process',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Lovable-Context', 'cron',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'
        )
      ),
      body := '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email_queue_wake failed (enqueue preserved): %', SQLERRM;
  RETURN NULL;
END;
$function$;

-- =====================================================================
-- S1) Innstramming av kjøretilgang på interne funksjoner
-- =====================================================================

REVOKE ALL ON FUNCTION public.insert_job_lead_dedup(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_job_lead_dedup(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.brreg_full_merge(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brreg_full_merge(bigint) TO service_role;

REVOKE ALL ON FUNCTION public.brreg_full_merge(bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brreg_full_merge(bigint, integer) TO service_role;

REVOKE ALL ON FUNCTION public.brreg_full_apply_refined_filter(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brreg_full_apply_refined_filter(bigint) TO service_role;

REVOKE ALL ON FUNCTION public.internal_ai_generation_commit_step(
  uuid, text, text, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, text, jsonb, uuid, text, text, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_ai_generation_commit_step(
  uuid, text, text, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, text, jsonb, uuid, text, text, boolean
) TO service_role;

-- Kalles av databasens egen planlegger (pg_cron kjører som postgres).
REVOKE ALL ON FUNCTION public.email_queue_dispatch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_queue_dispatch() TO service_role, postgres;

-- Trigger-funksjon: kan ikke kalles som RPC uansett. Ryddes for advisor-støy.
REVOKE ALL ON FUNCTION public.email_queue_wake() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_queue_wake() TO service_role, postgres;

-- =====================================================================
-- S2) get_user_employers: alltid innlogget bruker, ingen parameter
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_user_employers()
 RETURNS TABLE(company_id uuid, source text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT c.id, 'application'::text FROM public.applications a
    JOIN public.companies c ON c.id = a.company_id
    WHERE a.user_id = auth.uid() AND a.company_id IS NOT NULL
  UNION
  SELECT DISTINCT ucr.company_id, 'rating'::text FROM public.user_company_ratings ucr
    WHERE ucr.user_id = auth.uid() AND ucr.company_id IS NOT NULL
$function$;

REVOKE ALL ON FUNCTION public.get_user_employers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_employers() TO authenticated, service_role;

-- Bygg tilgangsreglene som pekte på den gamle signaturen på nytt, uendret virkning.
DROP POLICY IF EXISTS cpa_insert_linked ON public.company_profile_atoms;
DROP POLICY IF EXISTS cpa_update_linked ON public.company_profile_atoms;
DROP POLICY IF EXISTS cpa_delete_linked ON public.company_profile_atoms;
DROP POLICY IF EXISTS csa_insert_linked ON public.company_signal_atoms;
DROP POLICY IF EXISTS csa_update_linked ON public.company_signal_atoms;
DROP POLICY IF EXISTS csa_delete_linked ON public.company_signal_atoms;

CREATE POLICY cpa_insert_linked ON public.company_profile_atoms
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.get_user_employers() g WHERE g.company_id = company_profile_atoms.company_id));

CREATE POLICY cpa_update_linked ON public.company_profile_atoms
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.get_user_employers() g WHERE g.company_id = company_profile_atoms.company_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.get_user_employers() g WHERE g.company_id = company_profile_atoms.company_id));

CREATE POLICY cpa_delete_linked ON public.company_profile_atoms
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.get_user_employers() g WHERE g.company_id = company_profile_atoms.company_id));

CREATE POLICY csa_insert_linked ON public.company_signal_atoms
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.get_user_employers() g WHERE g.company_id = company_signal_atoms.company_id));

CREATE POLICY csa_update_linked ON public.company_signal_atoms
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.get_user_employers() g WHERE g.company_id = company_signal_atoms.company_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.get_user_employers() g WHERE g.company_id = company_signal_atoms.company_id));

CREATE POLICY csa_delete_linked ON public.company_signal_atoms
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.get_user_employers() g WHERE g.company_id = company_signal_atoms.company_id));

DROP FUNCTION IF EXISTS public.get_user_employers(uuid);

-- =====================================================================
-- S3) Fast søkevei på pgmq-hjelperne
-- =====================================================================

ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pg_temp;
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pg_temp;