# Skjemaøyeblikk før AI-integrasjonsmigrasjonen

**Tidspunkt:** 2026-09-08 (UTC)
**Type:** Read-only. Ingen skriving, ingen migrasjon, ingen endring av cron eller innstillinger.
**Migrasjon dette gjelder:** `20260908140601_ai_integration_foundation.sql`
**Innhold:** Kun skjemametadata. Ingen raddata, e-postadresser, UUID-er, tokens eller persondata.

## 1. Miljø

| Felt | Verdi |
| --- | --- |
| Database | Prosjektets konfigurerte Lovable Cloud-database (samme instans for preview og publisert app) |
| PostgreSQL | 17.6 (aarch64-linux) |
| `gen_random_uuid()` | Tilgjengelig (innebygd i PG17; `pgcrypto` 1.3 og `uuid-ossp` 1.1 finnes i skjemaet `extensions`) |
| Hemmeligheter | Ingen lest, ingen gjengitt |

## 2. Eksisterende tabell som migrasjonen endrer: `public.email_job_sources`

RLS: aktivert (`relrowsecurity = t`).

Kolonner (navn / type / null / default):

| Kolonne | Type | Null | Default |
| --- | --- | --- | --- |
| id | uuid | NO | `gen_random_uuid()` |
| user_id | uuid | NO | – |
| email_connection_id | uuid | YES | – |
| source_system | text | NO | – |
| intake_mode | text | NO | `'mailbox'` |
| label | text | YES | – |
| filter_query | text | YES | – |
| sender_pattern | text | YES | – |
| inbound_alias_token | text | YES | – |
| is_active | boolean | NO | `true` |
| last_synced_internal_date | text | YES | – |
| last_synced_at | timestamptz | YES | – |
| last_error | text | YES | – |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

`verified_at` finnes **ikke** i dag. Migrasjonens `ADD COLUMN IF NOT EXISTS verified_at timestamptz` er derfor en reell tilvekst.

Constraints:

- `email_job_sources_pkey` PRIMARY KEY (id)
- `email_job_sources_inbound_alias_token_key` UNIQUE (inbound_alias_token)
- `email_job_sources_intake_mode_check` CHECK (intake_mode IN ('mailbox','forwarding'))
- `email_job_sources_mailbox_needs_connection` CHECK (intake_mode <> 'mailbox' OR email_connection_id IS NOT NULL)
- `email_job_sources_source_system_check` CHECK (source_system IN ('finn','linkedin','other'))
- `email_job_sources_user_id_fkey` FK → auth.users(id) ON DELETE CASCADE
- `email_job_sources_email_connection_id_fkey` FK → email_connections(id) ON DELETE CASCADE

Indekser i dag:

- `email_job_sources_pkey` UNIQUE (id)
- `email_job_sources_inbound_alias_token_key` UNIQUE (inbound_alias_token)
- `email_job_sources_unique_mailbox_idx` UNIQUE (user_id, email_connection_id, source_system) WHERE email_connection_id IS NOT NULL

`email_job_sources_one_forwarding_per_user_idx` finnes ikke.

RLS-policyer i dag (alle for rollen `authenticated`, eierskap på `auth.uid()`):
`Users view own email_job_sources` (SELECT), `Users insert own email_job_sources` (INSERT), `Users update own email_job_sources` (UPDATE), `Users delete own email_job_sources` (DELETE).

Merknad om grants: uttrekket kjøres av en begrenset leserolle, som bare ser sine egne rettigheter i `information_schema.role_table_grants`. Faktiske `authenticated`/`service_role`-grants på denne tabellen bekreftes i verifikasjonssteget etter migrasjon (punkt 4 i kjøreplanen).

## 3. Avhengig funksjon

```
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
```

Signatur uten argumenter, returtype `trigger`, fast søkevei. Kompatibel med begge planlagte triggere.

## 4. Kollisjonskontroll for nye objekter

| Objekt | Finnes i dag |
| --- | --- |
| `public.ai_integrations` | Nei |
| `public.ai_integration_setup_sessions` | Nei |
| `public.automation_preferences` | Nei |
| `public.automation_runs` | Nei |
| `public.career_log_suggestions` | Nei |
| `email_job_sources_one_forwarding_per_user_idx` | Nei |
| `ai_integrations_user_status_idx` | Nei |
| `ai_integrations_email_job_source_idx` | Nei |
| `ai_setup_sessions_integration_open_idx` | Nei |
| `ai_setup_sessions_user_idx` | Nei |
| `automation_runs_user_created_idx` | Nei |
| `automation_runs_integration_idx` | Nei |
| `career_log_suggestions_user_status_idx` | Nei |
| `career_log_suggestions_integration_idx` | Nei |
| Trigger `set_ai_integrations_updated_at` | Nei |
| Trigger `set_automation_preferences_updated_at` | Nei |
| Policy-navn på de fem nye tabellene | Nei |

Ingen navnekollisjoner.

## 5. Datakontroll før unik indeks

Aggregert kontroll av `public.email_job_sources` der `intake_mode = 'forwarding'`:

- brukere med mer enn én rad: **0**
- høyeste duplikatantall: **0**

Ingen identifikatorer eller adresser er lest ut. `CREATE UNIQUE INDEX ... WHERE intake_mode = 'forwarding'` kan opprettes uten forutgående opprydding.

## 6. Aktive cron-jobber ved snapshot-tidspunktet

Aktive: `nav-sync-30min`, `careerjet-sync-6h`, `rydd-cron-logg`, `regnskap-sync-15min`, `ops-watchdog-hourly`, `brreg-enheter-full-start`, `brreg-enheter-full-driver`, `network-suggestions-worker-1min`, `network-suggestions-reaper-5min`, `careerjet-purge-60d`.

Inaktive: `linkedin-import-worker`, `linkedin-import-reaper`.

## 7. Siste registrerte migrasjoner (lest, ikke endret)

`20260907065414`, `20260907065308`, `20260903132533`, `20260903125733`, `20260903122434`, `20260903122337`, `20260901053229`, `20260827153619`, `20260827120135`, `20260827061217`.

## 8. Advisor-status før migrasjon (grunnlinje)

- 15 × RLS aktivert uten policy (INFO 0008)
- 1 × funksjon uten fast `search_path` (WARN 0011)
- 2 × utvidelse i `public` (WARN 0014)
- 16 × SECURITY DEFINER kallbar av `anon` (WARN 0028)
- 76 × SECURITY DEFINER kallbar av innlogget (WARN 0029)

Totalt 110 funn. Denne grunnlinjen brukes til å skille eksisterende funn fra nye funn etter migrasjonen.
