-- ============================================================================
-- ADVARSEL: DESTRUKTIV ROLLBACK. KREVER EGEN, EKSPLISITT GODKJENNING.
-- ----------------------------------------------------------------------------
-- Reverserer NØYAKTIG objektene innført av
--   20260908140601_ai_integration_foundation.sql
-- og ingenting annet.
--
-- Filen skal IKKE kjøres som del av normal drift, ikke automatisk, og ikke
-- uten at prosjekteier har bekreftet at rollback faktisk ønskes.
--
-- Sikkerhetsvakt: skriptet avbryter hele transaksjonen dersom noen av de fem
-- nye tabellene inneholder rader. Da må dataeier først bestemme hva som skal
-- skje med radene.
--
-- Filen rører IKKE supabase_migrations.schema_migrations.
-- Filen bruker IKKE CASCADE. Alle avhengigheter fjernes i eksplisitt rekkefølge.
-- ============================================================================

BEGIN;

SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 0. Sikkerhetsvakt: avbryt hvis noen av de fem tabellene har rader.
--    to_regclass gjør kontrollen trygg også om en tabell allerede er borte.
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE
  v_table text;
  v_count bigint;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'public.ai_integrations',
    'public.ai_integration_setup_sessions',
    'public.automation_preferences',
    'public.automation_runs',
    'public.career_log_suggestions'
  ] LOOP
    IF to_regclass(v_table) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %s', v_table) INTO v_count;
      IF v_count > 0 THEN
        RAISE EXCEPTION
          'ROLLBACK AVBRUTT: % inneholder % rad(er). Avklar datahåndtering før rollback.',
          v_table, v_count;
      END IF;
    END IF;
  END LOOP;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1. RLS-policyer
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users review own career_log_suggestions" ON public.career_log_suggestions;
DROP POLICY IF EXISTS "Users view own career_log_suggestions"   ON public.career_log_suggestions;

DROP POLICY IF EXISTS "Users view own automation_runs" ON public.automation_runs;

DROP POLICY IF EXISTS "Users delete own automation_preferences" ON public.automation_preferences;
DROP POLICY IF EXISTS "Users update own automation_preferences" ON public.automation_preferences;
DROP POLICY IF EXISTS "Users insert own automation_preferences" ON public.automation_preferences;
DROP POLICY IF EXISTS "Users manage own automation_preferences" ON public.automation_preferences;

DROP POLICY IF EXISTS "Users view own ai_integrations" ON public.ai_integrations;

-- ---------------------------------------------------------------------------
-- 2. Triggere (må bort før triggerfunksjonen eventuelt vurderes — funksjonen
--    public.update_updated_at_column() er FELLES og skal IKKE fjernes her)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_automation_preferences_updated_at ON public.automation_preferences;
DROP TRIGGER IF EXISTS set_ai_integrations_updated_at        ON public.ai_integrations;

-- ---------------------------------------------------------------------------
-- 3. Indekser på de nye tabellene
--    (droppes eksplisitt selv om DROP TABLE ville fjernet dem, slik at en
--     delvis feilet migrasjon også ryddes)
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.career_log_suggestions_integration_idx;
DROP INDEX IF EXISTS public.career_log_suggestions_user_status_idx;
DROP INDEX IF EXISTS public.automation_runs_integration_idx;
DROP INDEX IF EXISTS public.automation_runs_user_created_idx;
DROP INDEX IF EXISTS public.ai_setup_sessions_user_idx;
DROP INDEX IF EXISTS public.ai_setup_sessions_integration_open_idx;
DROP INDEX IF EXISTS public.ai_integrations_email_job_source_idx;
DROP INDEX IF EXISTS public.ai_integrations_user_status_idx;

-- ---------------------------------------------------------------------------
-- 4. Tabeller, i omvendt avhengighetsrekkefølge.
--    career_log_suggestions, automation_runs og ai_integration_setup_sessions
--    peker på ai_integrations, derfor droppes de først. Ingen CASCADE.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.career_log_suggestions;
DROP TABLE IF EXISTS public.automation_runs;
DROP TABLE IF EXISTS public.ai_integration_setup_sessions;
DROP TABLE IF EXISTS public.automation_preferences;
DROP TABLE IF EXISTS public.ai_integrations;

-- ---------------------------------------------------------------------------
-- 5. Endringer på eksisterende tabell public.email_job_sources.
--    Disse fjernes KUN som del av eksplisitt rollback.
--    Merk: DROP COLUMN verified_at sletter eventuelle verdier i kolonnen.
--    Sikkerhetsvakten over dekker ikke denne kolonnen, fordi tabellen er
--    eksisterende produksjonsdata. Bekreft bevisst før kjøring.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.email_job_sources_one_forwarding_per_user_idx;

ALTER TABLE public.email_job_sources
  DROP COLUMN IF EXISTS verified_at;

-- ---------------------------------------------------------------------------
-- 6. Grants forsvinner sammen med tabellene. Ingen grants på eksisterende
--    objekter ble endret av migrasjonen, så ingen REVOKE er nødvendig.
-- ---------------------------------------------------------------------------

COMMIT;

-- Etter kjøring: verifiser at ingen av de fem tabellene, de ni indeksene eller
-- de to triggerne finnes, og at email_job_sources igjen har 15 kolonner.
