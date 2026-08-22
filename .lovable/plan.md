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

### Database (additive migrasjoner)

`public.network_activity_suggestion_runs` — eier kjøringen:

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

- `network_enqueue_suggestion_run(p_user_id, p_scope, p_scope_object_id, p_input_signature, p_model_profile, p_prompt_version)` — idempotent: finnes en `queued`/`running` kjøring, eller en `succeeded` kjøring med samme `input_signature` og fortsatt `pending_review`-forslag, returneres den eksisterende kjøringen uten nytt modellkall. Håndhever rategrenser: **maks 6 kjøringer per bruker per rullerende time** og **maks 2 aktive (`queued`+`running`) kjøringer per bruker**, på tvers av alle scopes; over grensen returneres `rate_limited`.
- `network_claim_suggestion_run(p_lease_owner, p_lease_seconds)` — plukker én kjøring med lease.
- `network_heartbeat_suggestion_run(p_run_id, p_lease_owner)`.
- `network_finish_suggestion_run(p_run_id, p_lease_owner, p_status, p_error_code, p_model_run_id, p_items jsonb)` — skriver validerte forslag og setter status atomisk; ved retry-bar feil settes `queued` med eksponentiell backoff (maks 3 forsøk, deretter `failed`).
- `network_reap_stale_suggestion_runs()` — frigjør kjøringer med utløpt lease tilbake til `queued` med backoff.
- `network_decide_activity_suggestion(p_user_id, p_suggestion_id, p_decision, p_activity_id)` — `accepted`/`dismissed`, validerer eierskap på både forslag og aktivitet.

`input_signature` = hash av bruker, scope, scope-objekt, siste `updated_at` for alle inkluderte objekter, modellprofil og promptversjon. Endres data, endres signaturen og en ny kjøring tillates. Eksisterende `pending_review`-forslag settes først til `superseded` når en ny kjøring med **ny** signatur lykkes.

### Kjøring (arbeider)

- Arbeideren kjører i den eksisterende Deno-baserte KI-infrastrukturen (samme sted som `_shared/claude`), slik at Claude-klient, profiler og `ai.model_runs`-logging gjenbrukes uendret.
- Den claimer med lease, sender heartbeat underveis, kaller Claude med profilen, validerer JSON strengt med zod, kaster forslag som bruker ukjente `ref`-er eller ikke-eide objekt-ID-er, og avslutter via `network_finish_suggestion_run`.
- `pg_cron` trigger arbeideren jevnlig (lav frekvens) og kjører reaperen. Ingen synkron generering i `createServerFn`.

### Server (TanStack)

`src/lib/network-suggestions.functions.ts` (`requireSupabaseAuth`, `p_user_id` alltid fra sesjonen):

- `startActivitySuggestionRun` — bygger kontekst og `input_signature` serverside, kaller enqueue-RPC-en, returnerer `runId` og om den ble gjenbrukt eller rategrenset.
- `getActivitySuggestionRun` — status + forslag for polling.
- `decideActivitySuggestion` — `accepted` (med `created_activity_id`) eller `dismissed`.

### Klient

- `src/components/network/suggestion-panel.tsx`: startknapp, kø-/kjørestatus med polling, forslagskort med KI-merke og hydrerte kildelenker, «Godta og opprett» (åpner `ActivityDialog` forhåndsutfylt, med frist som må bekreftes eller settes til «Ingen dato»), «Avvis», og tydelige meldinger for rategrense og feil.
- Kobles inn på `/nettverk/oversikt`, `/nettverk/aktiviteter`, `nettverk.selskaper.$id`, `nettverk.kontakter.$id`, `nettverk.muligheter.$id`. «Kommer snart»-tilstanden fjernes.
- Bruker `useNetworkAuth`; feil vises via `NetworkErrorState`.

### Verifikasjon før ferdig

- Lik `input_signature` gir gjenbruk uten nytt modellkall; endret objekt-`updated_at` gir ny kjøring.
- Rategrensene 6/time og 2 aktive håndheves i databasen (syntetisk test).
- Ugyldig modellsvar og ukjent `ref` gir `failed`-kjøring uten at forslag skrives.
- Drept arbeider gjenopptas av reaperen; siden kan lukkes uten at kjøringen stopper.
- Aktivitet opprettes kun via `network_upsert_activity` etter eksplisitt fristvalg.
- To-brukertest: ingen kryssbruker-lesing eller -beslutning; ingen `anon`-grants; RLS uendret.
- `ai.model_runs` viser modell, promptversjon, tokenbruk og kostnad per kjøring.
