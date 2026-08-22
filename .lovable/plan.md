# Fase 5D — Aktivitetsforslag med KI (asynkron jobb, kontrollert brukerhandling)

## Hva brukeren får

Knappen «Få aktivitetsforslag» blir aktiv på Oversikt, Aktiviteter, selskapsdetalj, kontaktdetalj og mulighetsdetalj.

1. Brukeren starter en kjøring i en konkret kontekst. Kjøringen legges i kø og fortsetter selv om brukeren lukker siden.
2. Statusen vises som «I kø» / «Kjører» / «Ferdig» / «Feilet», og resultatet dukker opp når det er klart.
3. Forslagene vises som kort med tydelig KI-merking: tittel, begrunnelse, prioritet, foreslått tidspunkt og hvilke av brukerens egne objekter forslaget bygger på (som lenker).
4. Brukeren kan **Godta og opprett**, **Rediger før opprettelse** eller **Avvis**. Ved godkjenning åpnes den vanlige aktivitetsdialogen forhåndsutfylt, og brukeren må aktivt velge eller bekrefte frist — eller eksplisitt velge «Ingen dato» — før aktiviteten lagres.
5. Avviste og godtatte forslag beholder status, så de ikke dukker opp igjen.

KI oppretter aldri aktiviteter, endrer aldri status, sender aldri meldinger og kontakter aldri noen.

## Avgrensning (bygges ikke nå)

E-post, LinkedIn-meldinger, automatisk oppfølging/statusendring, automatisk LinkedIn-promotering, CV-/søknadsgenerering, arbeidsgiveranalyse og skjult modellfallback.

## Modell og logging

- Claude via den eksisterende server-side Claude-klienten (`supabase/functions/_shared/claude/client.ts`). Ingen Lovable AI Gateway, ingen Gemini, ingen fallback.
- Navngitt modellprofil `network_activity_suggestions_v1` med fast `taskKey`, modell-ID, `maxTokens` og requestOptions. Endres modellen, endres profilnavnet.
- Hver kjøring registreres i `ai.model_runs` via `internal_ai_start_model_run` / `internal_ai_finish_model_run`: modell, promptversjon, korrelasjons-ID, tokenbruk, varighet, status og kostnad.

## Datagrunnlag per kontekst

- **Oversikt:** åpne aktiviteter, aktuelle muligheter, prioriterte selskaper, varme kontakter.
- **Selskap:** selskapet, brukerens relasjon, kontakter, muligheter og aktiviteter ved selskapet.
- **Kontakt:** kontakten, selskapstilknytning, relevante muligheter, aktivitetshistorikk.
- **Mulighet:** stilling, selskap, søknadsstatus, frist, annonserelasjon, dokumentstatus, annonsekontakter, aktivitetslogg.

Aldri sendt til modellen: rå LinkedIn-anbefalingstekst, personlige meldinger, annonserings-/klikkdata og inferert LinkedIn-profilering, hemmeligheter/tokens, interne feillogger, andre brukeres data. Feltene kortes til et fast, kjent sett før de forlater serveren.

## Lukket evidensliste

Serveren bygger en nummerert, lukket liste over tillatte kildeobjekter (`ref` → `{objectType, objectId}`) og sender kun `ref`-ene til modellen. Modellen returnerer kun `ref`-er fra listen. Serveren avviser ukjente `ref`-er og hydrerer selv objekttype, navn, lenke og forklaring. Modellen kan ikke peke på vilkårlige objekt-ID-er.

## Teknisk gjennomføring

`public.network_activity_suggestion_scope_state` — eier regenereringstelleren:

- `user_id`, `scope`, `scope_object_id` (nullable kun for `overview`, CHECK som håndhever dette)
- `scope_key` (normalisert: `overview`, `company:<uuid>`, `contact:<uuid>`, `opportunity:<uuid>`) med unik nøkkel på `(user_id, scope_key)`
- `generation_epoch integer NOT NULL DEFAULT 0`, `updated_at`
- RLS: kun eier kan lese (`auth.uid() = user_id`); kun `service_role` skriver. GRANT `SELECT` til `authenticated`, `ALL` til `service_role`, ingen `anon`.

`public.network_activity_suggestion_runs` — eier kjøringen:

- `generation_epoch` lagres på kjøringen (verdien som inngikk i signaturen)


- `id`, `user_id`, `scope` (`overview` | `company` | `contact` | `opportunity`), `scope_object_id`
- `status`: `queued` | `running` | `succeeded` | `failed` | `cancelled`
- `input_signature` (text, unik sammen med `user_id` for aktive/ferdige kjøringer), `correlation_id`
- `model_profile`, `model_name`, `prompt_version`, `model_run_id` (peker til `ai.model_runs`)
- `lease_owner`, `lease_expires_at`, `heartbeat_at`, `attempt_count`, `next_attempt_at` (backoff), `error_code`, `suggestion_count`
- `created_at`, `started_at`, `finished_at`
- GRANT: `SELECT` til `authenticated` under RLS `auth.uid() = user_id`; `ALL` til `service_role`; ingen `anon`.

`public.network_activity_suggestions` — kun validerte forslag:

- `id`, `run_id` (FK), `user_id`, `source_class = 'ai_suggestion'` (default + CHECK)
- `activity_type`, `title`, `rationale`, `priority`, `suggested_timing` jsonb, `context` jsonb
- `evidence` jsonb (serverhydrert fra den lukkede listen)
- `status`: `pending_review` | `accepted` | `dismissed` | `superseded`, `decided_at`, `created_activity_id` (sammensatt FK `(id, user_id)` mot `next_steps`)
- Samme grants/RLS som over. Ingen `failed`-forslag: modellfeil lever kun på kjøringen. Ingen kobling til CV-evidens eller `user_attested`.

RPC-er (SECURITY DEFINER, ingen execute for anon/authenticated):

- `network_enqueue_suggestion_run(p_user_id, p_scope, p_scope_object_id, p_input_signature, p_generation_epoch, p_model_profile, p_prompt_version)` — validerer først at `scope_object_id` faktisk tilhører brukeren (selskapsrelasjon, kontakt eller mulighet eid av `p_user_id`); for `overview` må `scope_object_id` være `NULL`. Ugyldig kombinasjon gir `invalid_scope` uten kø. Deretter idempotent: finnes en `queued`/`running` kjøring, eller en `succeeded` kjøring med samme `input_signature`, returneres den eksisterende kjøringen uten nytt modellkall. Håndhever rategrenser: **maks 6 kjøringer per bruker per rullerende time** og **maks 2 aktive (`queued`+`running`) kjøringer per bruker**, på tvers av alle scopes; over grensen returneres `rate_limited`.
- `network_claim_suggestion_run(p_lease_owner, p_lease_seconds)` — plukker én kjøring med lease.
- `network_heartbeat_suggestion_run(p_run_id, p_lease_owner)`.
- `network_finish_suggestion_run(p_run_id, p_lease_owner, p_status, p_error_code, p_model_run_id, p_items jsonb)` — skriver validerte forslag og setter status atomisk; ved retry-bar feil settes `queued` med eksponentiell backoff (maks 3 forsøk, deretter `failed`).
- `network_reap_stale_suggestion_runs()` — frigjør kjøringer med utløpt lease tilbake til `queued` med backoff.
- `network_decide_activity_suggestion(p_user_id, p_suggestion_id, p_decision, p_activity_id)` — `accepted`/`dismissed`, validerer eierskap på både forslag og aktivitet.

### Idempotens og «Generer på nytt»

`input_signature` = hash av bruker, scope, scope-objekt, siste `updated_at` for alle inkluderte objekter, modellprofil, promptversjon og `generation_epoch`.

`generation_epoch` lagres per (bruker, scope, scope-objekt) og økes **kun** når brukeren eksplisitt trykker «Generer på nytt». Vanlig klikk på «Få aktivitetsforslag» med uendret grunnlag gjenbruker eksisterende kjøring uten modellkall. Når alle tidligere forslag er godtatt eller avvist, kan brukeren derfor be om en ny vurdering selv om datagrunnlaget er uendret — den unike signaturen blokkerer ikke.

Eksisterende `pending_review`-forslag settes til `superseded` først når en ny kjøring med ny signatur lykkes.

### Kjøring (arbeider)

- Worker-endepunkt: `POST /api/public/jobs/network-suggestions` (TanStack server-rute under `src/routes/api/public/`). Ingen ny edge-funksjon.
- Ruten autentiserer kalleren med en worker-hemmelighet fra runtime-secret (Vault), sammenlignet med konstant tid. Uten gyldig hemmelighet: 401, ingen arbeid.
- Claude kalles gjennom en serveronly-modul som gjenbruker den eksisterende Claude-klientens kontrakt: navngitt profil `network_activity_suggestions_v1`, ingen fallback, og logging via `internal_ai_start_model_run` / `internal_ai_finish_model_run`.
- Per kjøring: claim med lease, heartbeat underveis, streng zod-validering, forkasting av ukjente `ref`-er, avslutning via `network_finish_suggestion_run`. Fast tak på antall kjøringer per invokasjon (bounded batch) og circuit breaker som parkerer jobben ved gjentatte modellavvisninger.
- Reaper: `POST /api/public/jobs/network-suggestions-reaper` (samme hemmelighet) kaller `network_reap_stale_suggestion_runs()`.

### Driftsoppsett for cron

- Frekvens worker: hvert minutt. Frekvens reaper: hvert 5. minutt.
- `pg_cron` + `pg_net` peker på **publisert produksjons-URL** (`project--<id>.lovable.app`), aldri preview-URL.
- Rekkefølge: (1) bygg og publiser, (2) produksjons-smoke-test: autentisert `POST` mot begge endepunkter gir 2xx og korrekt «ingen arbeid»-svar, feil hemmelighet gir 401, (3) én reell, kontrollert kjøring verifiseres ende-til-ende med Henriks data, (4) **først da** aktiveres cron-jobbene. Cron settes ikke opp før punkt 1–3 er grønne.

### Server (TanStack)

`src/lib/network-suggestions.functions.ts` (`requireSupabaseAuth`, `p_user_id` alltid fra sesjonen):

- `startActivitySuggestionRun` — validerer scope og eierskap serverside før kø, bygger kontekst og `input_signature`, kaller enqueue-RPC-en, returnerer `runId` og om den ble gjenbrukt, rategrenset eller avvist på scope. Egen flagg `regenerate: true` øker `generation_epoch`.
- `getActivitySuggestionRun` — status + forslag for polling.
- `decideActivitySuggestion` — `accepted` (med `created_activity_id`) eller `dismissed`.

### Personvern i logg

`ai.model_runs` lagrer kun profil, modell, promptversjon, tokens, kostnad, status, feilkode, varighet og korrelasjons-ID. Aldri full prompt eller respons, rå kontaktdata eller annonsetekst. Det samme gjelder applikasjonslogger: kun ID-er og tellere. Forslagsinnhold finnes utelukkende i den bruker-scopede forslagstabellen under RLS.

### Klient

- `src/components/network/suggestion-panel.tsx`: startknapp, «Generer på nytt», kø-/kjørestatus med polling, forslagskort med KI-merke og hydrerte kildelenker, «Godta og opprett» (åpner `ActivityDialog` forhåndsutfylt, med frist som må bekreftes eller settes til «Ingen dato»), «Avvis», og tydelige meldinger for rategrense og feil.
- Kobles inn på `/nettverk/oversikt`, `/nettverk/aktiviteter`, `nettverk.selskaper.$id`, `nettverk.kontakter.$id`, `nettverk.muligheter.$id`. «Kommer snart»-tilstanden fjernes.
- Bruker `useNetworkAuth`; feil vises via `NetworkErrorState`.

### Verifikasjon før ferdig

- Lik `input_signature` gir gjenbruk uten nytt modellkall; endret objekt-`updated_at` eller «Generer på nytt» gir ny kjøring.
- Scope-validering: fremmed `companyId`/`contactId`/`opportunityId` og `overview` med objekt-ID avvises med `invalid_scope`.
- Rategrensene 6/time og 2 aktive håndheves i databasen (syntetisk test).
- Ugyldig modellsvar og ukjent `ref` gir `failed`-kjøring uten at forslag skrives.
- Drept arbeider gjenopptas av reaperen; siden kan lukkes uten at kjøringen stopper.
- Aktivitet opprettes kun via `network_upsert_activity` etter eksplisitt fristvalg.
- To-brukertest: ingen kryssbruker-lesing eller -beslutning; ingen `anon`-grants; RLS uendret.
- `ai.model_runs` viser modell, promptversjon, tokenbruk og kostnad — og ingen prompt-/responsinnhold.
- Produksjons-smoke-test grønn før cron aktiveres.

