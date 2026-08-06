# Avklaring: migrering fra Lovable Cloud til egen Supabase

Ingen migrering, cutover, eksport eller konfigurasjonsendring er utført. Dette er kun avklaring og plan.

## Svar 1 — eierskap

Bekreftet: backend-prosjektet `miwzhbludgwvskmsfqnq` er **Lovable Cloud-managed**. Det er provisjonert og administreres av Lovable, og ligger i en Lovable-eid Supabase-organisasjon — ikke i brukerens egen Supabase-konto. Derfor er det ikke synlig i brukerens Supabase Dashboard.

Praktiske konsekvenser, slik det er i dag:
- Ingen Supabase-dashboardtilgang, ingen DBA-rolle, ingen service role key, ingen DB-passord eller direkte connection string tilgjengelig for brukeren.
- Backup/restore, instansstørrelse og utvidelser styres gjennom Lovables Cloud-flate, ikke av brukeren.
- All backend-endring må gå via Lovables migrasjons- og Edge-deployverktøy (slik dagens PR-baserte flyt gjør).

Selve org-ID-en på Lovable-siden er ikke noe jeg kan lese ut eller publisere herfra; det må bekreftes skriftlig av Lovable support. Se «Hva vi trenger fra Lovable support» nederst.

## Svar 2 — migrasjonsvei

**Project transfer av et Cloud-managed prosjekt til brukerens egen Supabase-org støttes ikke** i produktet i dag. Prosjektet er ikke eksponert som et vanlig Supabase-prosjekt for eksterne kontoer, så det finnes ingen «transfer to organization»-knapp som kan brukes her. Det som må avklares direkte med Lovable support er om de kan gjøre det manuelt som et unntak — det er verdt å spørre om, men planlegg for at svaret er nei.

Av alternativene A–D er den realistiske veien en variant av **A + D**: nytt Supabase-prosjekt i brukerens egen org, og rekonstruksjon av innhold og konfigurasjon fra kilder vi allerede kontrollerer, supplert av Lovables dataeksport.

- **A (backup/restore til nytt prosjekt):** mulig, men ikke som en Supabase-nativ fysisk restore — det krever backup-artefakter som Cloud ikke eksponerer. Gjennomføres logisk (schema fra migrasjoner + data fra eksport).
- **B (pg_dump/pg_restore-kompatibel eksport):** ikke tilgjengelig selvbetjent. Cloud-fanen har «Export data» (Cloud → Advanced settings → Export data), som gir dataeksport, men ikke nødvendigvis en fullverdig `pg_dump`-fil med roller, grants og extension-state. Må bekreftes med support.
- **C (midlertidig direkte connection string):** ikke tilgjengelig via Lovable. Kun support kan eventuelt vurdere dette.
- **D (strukturert eksport av schema/data/auth/storage/config-inventar):** i praksis den mest gjennomførbare, fordi det meste allerede finnes i repoet.

## Hva vi allerede eier i repoet (ingen eksport nødvendig)

Dette gjør migrasjonen langt mindre risikabel enn en ren blackbox-flytt:

- **Schema for `public` og `reg`:** hele migrasjonshistorikken ligger i `supabase/migrations/`. Et nytt prosjekt kan bygges opp ved å kjøre migrasjonene i rekkefølge — det gir også korrekt `supabase_migrations`-historikk uten å måtte kopiere den tabellen.
- **Edge Functions:** all kildekode ligger i `supabase/functions/`, og `verify_jwt`-konfigurasjonen ligger i `supabase/config.toml`.
- **Cron-jobber:** definert i migrasjoner og dokumentert i `scripts/regnskap-sync-cron.sql` og `scripts/cron-job-run-details-maintenance.sql`.
- **Canary-tester:** `scripts/canary/*.sql` kan brukes som akseptansetester mot det nye prosjektet.
- **RLS-policies, funksjoner, grants, indekser:** følger av migrasjonene.

Det som **ikke** finnes i repoet og må skaffes: radnivådata i `public`/`reg`, `auth.users` (inkl. passord-hasher og identiteter), storage-objekter (filer + metadata), secret- og vault-**verdier**, samt pg_net/pg_cron kjøringshistorikk.

## Migrasjonsplan (ikke iverksatt)

```text
Fase 0  Avklaring med Lovable support (eierskap, transfer, eksportformat)
Fase 1  Inventar og frys av backend-endringer
Fase 2  Opprett nytt Supabase-prosjekt i brukerens org
Fase 3  Bygg schema fra migrasjonshistorikk + verifiser med canaries
Fase 4  Dataflytt (public/reg), deretter auth users, deretter storage
Fase 5  Re-etabler extensions, cron, vault, Edge Functions, secrets
Fase 6  Oppdater OAuth/redirect/callback for ny project ref
Fase 7  Cutover av frontend-env + verifikasjon
```

### Fase 1 — inventar (read-only, kan gjøres nå på forespørsel)
Produsere et dokument med: tabeller og radantall i `public` og `reg`, alle funksjoner/policies/grants, alle extensions, alle cron-jobber, alle storage-buckets og objekt-antall, alle secret- og vault-**navn** (aldri verdier), alle Edge Functions med `verify_jwt`-status, og alle auth-provider-innstillinger. Dette blir sjekklisten migrasjonen valideres mot.

### Fase 4 — data
- `public`/`reg`: `reg.enheter` (~440k) og `reg.regnskap_sync_status` (~440k) er de tunge. Disse bør flyttes som CSV/COPY i batcher, ikke via API, ellers blir det timeouts.
- `auth.users`: kan kun migreres med passord-hasher hvis Lovable leverer en eksport som inkluderer `auth`-schemaet. Hvis ikke, er alternativet å opprette brukerne på nytt i det nye prosjektet og tvinge passord-reset. **Dette er det viktigste enkeltspørsmålet til support**, fordi svaret avgjør om migrasjonen er usynlig for sluttbrukere eller ikke.
- Aktive sesjoner og refresh-tokens migreres ikke uansett — alle brukere blir logget ut ved cutover.
- Storage: filer må lastes ned og lastes opp på nytt; objekt-metadata (eier, mime, path) følger med i opplastningen.

### Fase 5 — state som ikke kopieres, men re-etableres
- `pg_cron`: jobber schedules på nytt i det nye prosjektet. `cron.job_run_details` **ekskluderes** bevisst (det er nettopp den tabellen som har vært et driftsproblem).
- `pg_net`: `net._http_response` ekskluderes; kun extension-aktivering re-etableres.
- Vault: hemmelighetene må settes på nytt manuelt (f.eks. `regnskap_sync_cron_secret`). Verdier skal aldri gjengis i chat.
- Edge Function secrets: settes på nytt i det nye prosjektet med samme navn.

### Fase 6 — auth/OAuth ved ny project ref
Ny ref endrer både Supabase-URL og auth-callback-URL. Må oppdateres:
- Site URL og redirect allow-list i det nye prosjektet.
- Google OAuth: nye authorized redirect URIs i Google Cloud Console.
- LinkedIn OAuth: ny callback-URL i LinkedIn-appen (`linkedin-login`, `linkedin-start`, `linkedin-connect`).
- Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`.
- Merk: `src/lib/supabase.ts` har i dag en hardkodet fallback-URL til dagens ref som må fjernes/oppdateres.
- Alle absolutte `functions/v1/...`-URL-er (cron-body, runbooks) peker på gammel ref og må skrives om.

### Fase 7 — frontend-kobling
Lovable støtter å bruke en brukereid Supabase i stedet for Cloud, men **Cloud kan ikke slås av for dette prosjektet i ettertid** — det er irreversibelt knyttet til prosjektet. Praktisk betyr det at appen enten fortsetter å ha Cloud koblet på mens all faktisk trafikk peker mot det nye prosjektet, eller at frontend flyttes til et nytt Lovable-prosjekt koblet til brukerens Supabase fra start. Dette valget bør tas før Fase 2.

## Risiko

| Risiko | Konsekvens | Håndtering |
| --- | --- | --- |
| `auth.users` kan ikke eksporteres med hasher | Alle brukere må resette passord | Avklares i Fase 0 før noe annet starter |
| Ingen `pg_dump`-tilgang | Datamigrering blir manuell og treg | Batch-COPY, kjør Fase 4 i vedlikeholdsvindu |
| Cloud kan ikke frakobles | Dobbelt backend-oppsett i samme prosjekt | Vurder nytt Lovable-prosjekt for frontend |
| 440k-radstabeller | Timeouts under flytt | Batching, sync-jobber pauses under flytt |
| Skrivetrafikk under migrering | Datatap/divergens | Frys `regnskap-sync` og øvrige cron før Fase 4 |

## Hva vi trenger fra Lovable support (Fase 0)

Send disse spørsmålene skriftlig:
1. Bekreft at `miwzhbludgwvskmsfqnq` er Cloud-managed, og oppgi eiende Supabase-organisasjon.
2. Kan prosjektet overføres til brukerens egen Supabase-org? Hvis ja, hvordan og med hvilken nedetid?
3. Hvis nei: kan dere levere en `pg_dump`-kompatibel eksport, og inkluderer den `auth`-schemaet med passord-hasher?
4. Kan dere levere storage-objekter som en nedlastbar arkiv-eksport?
5. Kan dere gi en tidsbegrenset direkte DB connection string for kontrollert dump?
6. Hva skjer med det eksisterende Cloud-prosjektet og faktureringen etter en migrering?

## Neste steg

Ingenting iverksettes uten eksplisitt godkjenning. Det eneste jeg foreslår å gjøre nå — hvis du vil — er **Fase 1-inventaret**, som er rent read-only og gir sjekklisten resten av migrasjonen måles mot.
