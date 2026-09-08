# Kjøreplan for AI-integrasjonsmigrasjonen

**Migrasjon:** `20260908140601_ai_integration_foundation.sql`
**Rollback:** `supabase/rollback/20260908140601_ai_integration_foundation.rollback.sql`
**Skjemaøyeblikk:** `docs/database/pre-ai-integration-schema-snapshot-20260908.md`
**Status:** Ikke kjørt. Krever egen godkjenning.

## A. Verifikasjon av migrasjonsfilen

| Kontroll | Resultat |
| --- | --- |
| Ikke-transaksjonelle operasjoner (`CREATE INDEX CONCURRENTLY`, `VACUUM`, `CREATE DATABASE`, `REINDEX`, `ALTER SYSTEM`, `CREATE TABLESPACE`) | Ingen treff. Hele filen kan kjøres i én transaksjon. |
| Egne `BEGIN`/`COMMIT` i filen | Ingen. Kjøres derfor i én ytre transaksjon. |
| Avhengighet `public.email_job_sources` med `user_id` og `intake_mode` | Finnes. |
| `verified_at` finnes fra før | Nei. `ADD COLUMN IF NOT EXISTS` er en reell tilvekst. |
| Avhengighet `public.update_updated_at_column()` | Finnes, uten argumenter, returnerer `trigger`, fast `search_path`. Begge triggerne er kompatible. |
| Navnekollisjoner (5 tabeller, 9 indekser, 2 triggere, alle policy-navn) | Ingen. |
| Data blokkerer den unike forwarding-indeksen | Nei. 0 brukere med duplikat. |
| FK-referanser | `auth.users(id)` (5 steder), `public.email_job_sources(id)`, `public.ai_integrations(id)` (3 steder). Alle eksisterer eller opprettes tidligere i samme fil. |
| Constraints | Alle CHECK-uttrykk er immutable (ingen `now()`-avhengige sjekker). OK. |
| GRANT-krav på nye public-tabeller | Alle fem tabeller har grants til `authenticated` og/eller `service_role`. Ingen `anon`-grants. OK. |
| RLS | Aktivert på alle fem tabeller. |

### De fire Advisor-baserte FK-indeksene

| Indeks | Finnes i vedlegget | Linje |
| --- | --- | --- |
| `ai_integrations_email_job_source_idx` | Ja | 39–41 |
| `ai_setup_sessions_user_idx` | Ja | 65–66 |
| `automation_runs_integration_idx` | Ja | 119–121 |
| `career_log_suggestions_integration_idx` | Ja | 155–157 |

### Forhold å være oppmerksom på (ikke feil, men bevisste valg som gir Advisor-utslag)

1. `public.ai_integration_setup_sessions` har RLS aktivert, men ingen policy. Tabellen er kun ment for `service_role`. Dette gir ett nytt INFO 0008-funn («RLS enabled, no policy»), i tråd med tabellens formål. Dokumentert i sikkerhetsminnets kategori for driftstabeller.
2. `automation_runs` og `career_log_suggestions` har `ai_integration_id ON DELETE SET NULL` og ingen `updated_at`; ingen trigger er derfor nødvendig for dem.
3. `ai_integration_setup_sessions` har `user_id`-FK mot `auth.users` og indeks på `user_id`, men ingen indeks på `provider`. Ikke nødvendig for v1-spørringene.

## B. Rekkefølge ved gjennomføring

1. **Bekreft fersk eksport.** Prosjekteier bekrefter at full dataeksport fra Cloud → Advanced settings → Export data er tatt samme dag, og at filen er lastet ned og lesbar.
2. **Stopp de fem avtalte cron-jobbene** (SQL under, punkt C). Vent til pågående kjøringer er ferdige.
3. **Kjør migrasjonen i én transaksjon.** Hele filen `20260908140601_ai_integration_foundation.sql` som én migrasjon. Feil ruller alt tilbake automatisk.
4. **Verifiser** at de fem tabellene, ni indeksene, to triggerne, alle constraints, grants (`authenticated`/`service_role`, ingen `anon`) og RLS-policyene finnes som spesifisert, og at `email_job_sources` nå har 16 kolonner.
5. **Kjør funksjonelle tester med to demo-brukere:** bruker A skal se kun egne rader i `ai_integrations`, `automation_preferences`, `automation_runs` og `career_log_suggestions`; forsøk på å lese bruker B sine rader skal gi tomt resultat. Innsetting av en andre `forwarding`-rad for samme bruker skal avvises av den unike indeksen. Oppdatering av felt utenfor kolonnelisten i `career_log_suggestions` skal avvises av kolonne-grantet.
6. **Kjør Security Advisor og Performance Advisor.** Sammenlign mot grunnlinjen i skjemaøyeblikket (110 funn: 15 INFO 0008, 1 WARN 0011, 2 WARN 0014, 16 WARN 0028, 76 WARN 0029). Forventet ny differanse: +1 INFO 0008 for `ai_integration_setup_sessions`. Alt annet nytt behandles som reelt funn.
7. **Start cron-jobbene igjen** (SQL under, punkt C).
8. **Rollback kun ved godkjent behov.** Kjør rollbackfilen, som avbryter av seg selv hvis noen av de fem tabellene har fått rader.

## C. SQL for stans og gjenstart av cron (IKKE kjørt)

Stans før migrasjon:

```sql
UPDATE cron.job
SET active = false
WHERE jobname IN (
  'network-suggestions-worker-1min',
  'network-suggestions-reaper-5min',
  'regnskap-sync-15min',
  'brreg-enheter-full-driver',
  'nav-sync-30min'
);

-- Kontroll: skal returnere fem rader med active = false
SELECT jobname, active FROM cron.job
WHERE jobname IN (
  'network-suggestions-worker-1min',
  'network-suggestions-reaper-5min',
  'regnskap-sync-15min',
  'brreg-enheter-full-driver',
  'nav-sync-30min'
);
```

Gjenstart etter verifisert migrasjon:

```sql
UPDATE cron.job
SET active = true
WHERE jobname IN (
  'network-suggestions-worker-1min',
  'network-suggestions-reaper-5min',
  'regnskap-sync-15min',
  'brreg-enheter-full-driver',
  'nav-sync-30min'
);
```

`linkedin-import-worker` og `linkedin-import-reaper` er allerede inaktive og skal **ikke** aktiveres av denne operasjonen. Øvrige aktive jobber (`careerjet-sync-6h`, `rydd-cron-logg`, `ops-watchdog-hourly`, `brreg-enheter-full-start`, `careerjet-purge-60d`) berøres ikke; unngå å kjøre migrasjonen i deres tidsvindu (03:00, 03:20, 04:00, samt minutt 7 hver time).

## D. Advisor-skille

| Kategori | Grunnlinje før | Forventet etter | Behandling |
| --- | --- | --- | --- |
| INFO 0008 RLS uten policy | 15 | 16 | Det nye funnet er `ai_integration_setup_sessions`, bevisst service_role-only. Dokumenteres, lukkes ikke. |
| WARN 0011 mutable search_path | 1 | 1 | Uendret, eksisterende. |
| WARN 0014 extension i public | 2 | 2 | Uendret, eksisterende. |
| WARN 0028 anon SECURITY DEFINER | 16 | 16 | Migrasjonen oppretter ingen funksjoner. Enhver økning er et reelt nytt funn. |
| WARN 0029 authenticated SECURITY DEFINER | 76 | 76 | Samme. |

Performance Advisor: de fire FK-indeksene er tatt med nettopp for å unngå «unindexed foreign key»-funn. Eventuelle nye funn på de fem tabellene skal vurderes som reelle.
