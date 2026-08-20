# Leveranse A — LinkedIn-import: varig bakgrunnskjøring, status og in-app-varsling

Kun driftslaget. Ingen endring i feltmapping, endorsements, anbefalinger, kursmapping, nettverksmodell eller promotering.

## 0. Preflight — funn (verifisert nå)

**`linkedin_imports` har i dag:** `id, user_id, archive_sha256, content_manifest_hash, contract_version, status, canonical_import_id, error_code, error_summary, archive_available, active_phase, attempt_id, heartbeat_at, staging_started_at, known/unknown/excluded/valid/invalid_file_count, staged_record_count, excluded_reason_counts, created_at, validated_at, staged_at, cancelled_at, purged_at`. Det finnes altså felt for fase/attempt/heartbeat, men ingen forsøkstabell, ingen lease, ingen cursor, ingen retrybudsjett, og ingen storage-referanse til ZIP-en.

**Opplastingsruten (`POST /api/linkedin/imports`) kjører i dag hele jobben synkront i brukerens request:** `validateAndStageArchive` og deretter `runReconciliation`. Ingen kø, ingen worker-trigger. `GET`-ruten «reparerer» hengende importer ved å stemple alt eldre enn 5 minutter som `failed` — en tidsbasert nødløsning som fjernes.

**ZIP-en lagres ikke.** Bøtta `linkedin-imports` (privat) finnes, men opplastingsruten skriver aldri til Storage; interne workere tar arkivet som `archive_base64` i request-body. Uten varig ZIP kan ingen bakgrunnsworker gjenoppta arbeid. Dette er en blokker som må lukkes i denne leveransen.

**Interne worker-ruter finnes:** `/api/internal/linkedin-import-worker` og `/api/internal/linkedin-reconciliation-worker`, begge POST-only med `x-worker-secret` i konstant tid før databasekontakt. Mønsteret beholdes.

**Varig trigger finnes:** `pg_cron` + `pg_net` er i aktiv bruk (7 jobber), og kaller allerede prosjektets egne HTTP-ruter på den stabile `project--<id>.lovable.app`-URL-en. Dette er den varige mekanismen vi bruker.

**Viktig konsekvens:** ruter under `/api/internal/*` er auth-blokkert på publisert site og kan ikke nås av pg_cron. Worker og reaper må derfor eksponeres under `/api/public/linkedin/...` (prefikset som slipper gjennom edge-auth) med uendret hemmelighetskontroll i handleren — hemmeligheten er sikkerhetsgrensen, ikke stien. Eksisterende `/api/internal`-ruter beholdes som interne kall.

**Runtime-budsjett:** pg_net-kallene bruker 150 s timeout. Worker-invokasjonen får et hardt internt budsjett på 50 sekunder og avslutter alltid kontrollert på chunk-grense.

**In-app-varslingsmodell finnes ikke.** Må opprettes minimalt og user-scoped.

## 1. Datamodell (migrasjoner, additivt)

`public.linkedin_import_attempts` med feltene i instruksen (`cursor_json`, `lease_owner`, `lease_expires_at`, `heartbeat_at`, `next_retry_at`, `retry_count`, `max_attempts` = 5, tellere, `error_code`, `error_summary`, `cancellation_requested_at`). Statuser: `queued, running, succeeded, partially_succeeded, failed, cancelled, expired`. Faser: `queued, validating_archive, staging, reconciling, finalizing`.

- Partiell unik indeks: maks én `queued`/`running` attempt per import.
- Indeks for claim: `(status, next_retry_at)` der status = `queued`.
- `linkedin_imports` får `archive_storage_path` (privat path i `linkedin-imports`-bøtta) og `last_attempt_id`.
- RLS: eier kan kun `SELECT` egne attempts. Ingen klientskriv til status, lease, cursor, heartbeat eller feilfelt. GRANT `SELECT` til `authenticated`, `ALL` til `service_role`.

`public.user_notifications`: `id, user_id, notification_kind, linkedin_import_id, attempt_id, title, body, deep_link, read_at, created_at`. Unik indeks på `(user_id, linkedin_import_id, notification_kind)` gir idempotens — ett varsel per import per terminalt utfall.

RLS og immutabilitet for varsler:
- `SELECT`: kun `auth.uid() = user_id`.
- `INSERT`/`DELETE`: ingen klientpolicy; kun `service_role`.
- `UPDATE`: én avgrenset policy for eier, kombinert med en `BEFORE UPDATE`-trigger som avviser enhver endring av `notification_kind`, `title`, `body`, `deep_link`, `linkedin_import_id`, `attempt_id`, `user_id` og `created_at`. Kun `read_at` kan endres. Frontendlogikk regnes ikke som håndhevelse.
- `read_at` er monoton: eneste tillatte klientovergang er `NULL → gyldig tidspunkt` (trigger setter verdien til `now()` og avviser fremtidige tidspunkt). Når `read_at` først er satt, kan den verken nullstilles eller endres. Varslingshistorikken kan dermed ikke manipuleres fra frontend.

- GRANT: `SELECT, UPDATE` til `authenticated`, `ALL` til `service_role`.

## 2. Serverfunksjoner (SECURITY DEFINER, kun service_role)

`linkedin_import_claim_next_attempt` (atomisk, `FOR UPDATE SKIP LOCKED`, setter lease 180 s), `linkedin_import_heartbeat`, `linkedin_import_complete_attempt`, `linkedin_import_fail_attempt` (skiller retrybar/ikke-retrybar, setter `next_retry_at` etter 1/5/15/60 min), `linkedin_import_reap_expired_attempts`.

Reaper-semantikk (må gjenoppta, ikke bare markere):
- Lease er >2x heartbeat-margin, så levende workere berøres aldri.
- Utløpt lease → gammelt attempt settes `expired` med sanitert årsak (`lease_expired`).
- I samme transaksjon opprettes atomisk et nytt `queued` attempt med `attempt_number + 1`, arvet `cursor_json` og `retry_count + 1`, så lenge samlet retrybudsjett (maks 5) tillater det.
- Først når budsjettet er brukt opp settes importen `failed` og terminalt varsel opprettes.
- Invariant som testes: en import kan aldri stå igjen med kun `expired`/avsluttede attempts og gjenværende budsjett.


## 3. Ruter

- `POST /api/linkedin/imports` gjøres om til ren kvittering: autentiser, valider minimal integritet, skriv ZIP til privat Storage, opprett/gjenbruk `linkedin_imports` (uendret sha256-dedupregel), opprett `queued` attempt, svar `{ import_id, status: "queued" }`. Ingen parsing i requesten. 5-minutters «stale»-stemplingen i `GET` fjernes; status kommer fra attempt-modellen.
- Storage-integritet: `archive_storage_path` settes **kun** etter bekreftet vellykket privat skriving, i samme skritt som `archive_available = true`. Feiler Storage-skrivingen, settes ingen path, `archive_available` forblir `false`, importen/attemptet får kontrollert `storage_write_failed` og det opprettes aldri et `queued` attempt. En DB-invariant (CHECK/trigger) forbyr `archive_available = true` uten path. Workeren verifiserer at objektet finnes før arbeid startes, og feiler kontrollert som `archive_missing` (ikke-retrybar) ellers.
- `GET /api/linkedin/imports` utvides med fase, tellere, `heartbeat_at`, retry-info og siste attempt.
- `POST /api/public/linkedin/import-worker` og `POST /api/public/linkedin/import-reaper`: POST-only, `x-worker-secret` i konstant tid før all databasekontakt, avviser brukerens JWT, saniterte svar. Workeren claim'er én attempt, henter ZIP fra Storage, kjører avgrensede chunks av eksisterende `validateAndStageArchive` / `runReconciliation`, lagrer cursor + tellere + heartbeat mellom chunks, og avslutter innen tidsbudsjettet slik at neste invokasjon fortsetter.
- `POST /api/linkedin/imports/:id/cancel` og `/retry`: setter cancellation requested (worker stopper på neste sikre chunk-grense, ingen sletting av gyldig staging) eller oppretter nytt attempt med bevart historikk.
- Hemmelighet i to miljøer: `LINKEDIN_IMPORT_WORKER_SECRET` lagres som runtime-secret for ruten (via `generate_secret`) og samme verdi legges i Supabase Vault under samme navn for pg_net-kallet. Ingen annen hemmelighet gjenbrukes. Før cron aktiveres kjøres en kontrollert hemmelighetstest: ett `net.http_post` med vault-verdien mot worker-ruten skal gi 200/`no_work`, og ett kall uten/med feil hemmelighet skal gi 401 — begge verifiseres i `net._http_response` uten at verdien logges.
- pg_cron aktiveres først etter bestått hemmelighetstest: worker hvert minutt, reaper hvert 5. minutt, begge med hemmelighet hentet fra vault.


## 4. Statusavbildning

Attempt-status → importstatus følger tabellen i instruksen. Importstatus står aldri `running` uten aktiv eller gjenopptakbar attempt; avsluttede attempts går aldri tilbake til `running`; historikk overskrives aldri.

## 5. UI (kun importkortet + toppvarsel)

`linkedin-import-card.tsx` viser fasetekst (Venter på behandling / Validerer arkiv / Leser valgte kilder / Avstemmer funn / Ferdig / Delvis ferdig / Krever oppfølging), sist heartbeat mens arbeid pågår, kjente tellere, og knappene Avbryt / Prøv igjen / Se gjennom funn. Ingen falsk prosent. Et lite varselikon i headeren viser uleste `user_notifications` med deep link. Ingen e-post.

## 6. Verifikasjon

Syntetiske arkiv, aldri Henriks reelle eksport. Testmatrisen i instruksens punkt 10 kjøres i sin helhet: kvittering før tungt arbeid, fortsettelse uten browser, dobbel-claim, lease/heartbeat/reaper, backoff og cursor-gjenopptak, ikke-retrybare feil, retrybudsjett, delvis suksess, avbryt på chunk-grense, dedup ved identisk arkiv, hemmelighetskontroll, RLS mellom brukere, idempotente varsler, og at retention (7 dager ZIP / 90 dager staging) og produktdata er urørt.

I tillegg testes de fire korreksjonene eksplisitt: (a) vault- og runtime-hemmelighet gir samme resultat, feil hemmelighet gir 401; (b) simulert Storage-feil gir ingen path, `archive_available = false` og ingen `queued` jobb; (c) reaper på utløpt lease gir nytt `queued` attempt med arvet cursor så lenge budsjett gjenstår, og `failed` først når budsjettet er tomt; (d) klientforsøk på å endre `title`/`deep_link`/`notification_kind` på eget varsel avvises, mens `read_at` går gjennom.

## 7. Leveranse

Preflight-notat (dette kapittel 0, utvidet), migrasjons- og datamodelloversikt, ruteoversikt, RLS-/grant-rapport, driftsrunbook, oppdatert `docs/linkedin-import-contract-v1.md`, og testmatrise med resultater. Stopp for godkjenning før Leveranse B.
