# Sikkerhetsgrunnlag før CASA — oppdatert etter gjennomgang (S1–S7)

Gjennomgangen din er tatt inn. To ting er nå avklart mot databasen, og to nye detaljer dukket opp i rettighetsuttrekket.

## Avklaringer på de åpne punktene

**`email_queue_dispatch` — kallstedet er funnet.** Den kalles ikke fra appkoden. Funksjonen er selve kroppen til en dynamisk cron-jobb (`process-email-queue`) som armes av `email_queue_wake` når noe legges i e-postkøen, og som avskilter seg selv når køen er tom. Den POSTer videre til `/lovable/email/queue/process`. Den er altså i aktiv bruk, kalt av databasens egen planlegger — ikke død kode, og ikke noe å fjerne. Innstramming til `service_role` (pluss `postgres`, som cron kjører som) er trygt.

**`email_queue_wake` må med i samme runde.** Den er også `anon`- og `authenticated`-kallbar i dag, og er inngangen som armer cron-jobben. Uten den i listen kan en uinnlogget besøkende fortsatt trigge planleggeren. Legges til som sjette funksjon i S1.

**`brreg_full_apply_refined_filter` — ikke død kode i drift.** Den har en `GRANT ... TO service_role` i migrasjon `20260815145610`, men rettighetslisten viser at `PUBLIC`, `anon` og `authenticated` fortsatt står der ved siden av. Ingen `REVOKE` ble kjørt. Samme mønster som S7 beskriver.

**`brreg_full_merge` finnes i to varianter.** `(p_run_id bigint)` er allerede korrekt låst til `service_role`. `(p_run_id bigint, p_batch integer)` — den nyere signaturen, som er den koden faktisk kaller — er åpen for `PUBLIC`, `anon` og `authenticated`. Dette er S7-feilklassen svart på hvitt: ny signatur, ny funksjon, standardrettigheter tilbake. Begge signaturer strammes inn.

## S1 — Innstramming av åpne funksjoner (utvidet til seks)

Trekk tilbake `EXECUTE` fra `PUBLIC`, `anon` og `authenticated`, behold/gi `service_role`:

- `insert_job_lead_dedup(jsonb)` — kalles via tjenestenøkkel i `ingest.ts`.
- `brreg_full_merge(bigint, integer)` og `brreg_full_merge(bigint)` — kalles via tjenestenøkkel.
- `brreg_full_apply_refined_filter(bigint)`.
- `internal_ai_generation_commit_step(...)` — kalles med adminklient fra generatorløperen.
- `email_queue_dispatch()` og `email_queue_wake()` — kalles av databasens planlegger. Her beholdes også `postgres`.

Ingen av disse har et kallsted fra klientsiden, så appen påvirkes ikke.

## Runde 2 — nye avklaringer

**`email_queue_wake` er en trigger-funksjon, ikke en RPC.** Live-definisjonen viser `RETURNS trigger`, `SECURITY DEFINER`, og at den fyres inne i innleggingstransaksjonen: den tar et rådgivende lås, planlegger `process-email-queue` (`5 seconds`) hvis jobben ikke finnes, og POSTer straks til `/lovable/email/queue/process`. Arm/disarm-mekanismen er altså reell — «5-second interval» i `email_infra.sql` beskriver intervallet på jobben `wake` oppretter, ikke en statisk jobb. Fordi den kun kjøres av trigger-maskineriet, brytes ingenting av å trekke tilbake `EXECUTE` fra `anon`/`authenticated`.

**Søkevei er allerede satt på begge.** `email_queue_dispatch` og `email_queue_wake` har begge `SET search_path TO ''` i live-definisjonen. Ditt sekundære poeng er dermed dekket — ingen ekstra søkevei-linje for disse to. De fire pgmq-wrapperne i S3 mangler den fortsatt.

**Manglende migrasjonsspor bekreftet.** Ingen `CREATE FUNCTION` for `email_queue_dispatch` eller `email_queue_wake` finnes i `supabase/migrations/` — kun kommentartekst i de sju `email_infra`-filene. Begge er opprettet direkte mot databasen av e-postinfrastrukturen. De legges inn i denne migrasjonen som `CREATE OR REPLACE FUNCTION` med kroppen hentet ordrett fra `pg_get_functiondef`, uendret atferd, kun for å få dem i versjonskontroll — plassert før `REVOKE`/`GRANT`-linjene for de samme to. Forbehold: e-postintegrasjonen eier disse funksjonene og kan regenerere dem ved en senere oppgradering; da gjelder S7-regelen, og innstrammingen må gjentas.



## S2 — `get_user_employers`

Bekreftet: kun `authenticated` (ikke `anon`) har tilgang, ingen `auth.uid()`-sjekk, og nøyaktig ett kallsted — `src/lib/queries/companies.ts` linje 111, alltid med brukerens eget ID. Rettelsen: ny parameterløs versjon filtrert på `auth.uid()`, gammel signatur droppes, og kallstedet endres til `supabase.rpc("get_user_employers")`.

## S3 — Fast søkevei

`delete_email`, `enqueue_email`, `move_to_dlq`, `read_email_batch` får `SET search_path = public, pg_temp`. Uendret fra forrige plan, bekreftet i aktiv bruk.

## S4, S5 — Bevisste valg

RLS uten policy på driftstabellene beholdes (ingen API-vei dit). `pg_trgm` og `vector` blir liggende i `public` — flyttingen treffer operatorklasser som arbeidsgiversøkets indekser peker på, og gevinsten er marginal. Begge dokumenteres i sikkerhetsminnet framfor å endres.

## S6 — Sikkerhetsheadere i `src/server.ts`

- `Content-Security-Policy-Report-Only` først, satt sammen etter en gjennomgang av hva appen faktisk laster. Håndheving først når rapporten er stille.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` som slår av kamera/mikrofon/geolokasjon, `X-Frame-Options: DENY`.
- Ingen headere på `/api/public/*` — de rutene kalles av eksterne tjenester og av cron.
- `frame-ancestors 'none'` kun på det publiserte domenet, ikke i forhåndsvisning (som kjører i iframe).

## S7 — Fast regel, ikke bare linterkjøring

Analysen din er riktig og er nå bekreftet av rettighetsuttrekket: `DROP FUNCTION` + ny `CREATE FUNCTION` (eller `CREATE OR REPLACE` med endret parameterliste) gir et nytt funksjonsobjekt med Postgres' standard `EXECUTE` til `PUBLIC`. Både `brreg_full_merge` og `internal_ai_generation_commit_step` havnet tilbake i advisor-skannet på nøyaktig denne måten.

Regelen som legges i sikkerhetsminnet: enhver migrasjon som endrer signaturen til en `SECURITY DEFINER`-funksjon med innskrenkede rettigheter må inneholde `REVOKE`/`GRANT`-linjene på nytt i samme migrasjon. Linterkjøring etter hver migrasjon beholdes som nett under, ikke som førstelinje.

## Rekkefølge

1. Én migrasjon: S1 (seks funksjoner, begge `brreg_full_merge`-signaturer), S2 (ny parameterløs funksjon + drop av gammel), S3 (søkevei).
2. Kodeendring: `src/lib/queries/companies.ts` linje 111 til parameterløst kall.
3. Kjør linteren, bekreft at S1/S2/S3-funnene er borte og at ingen nye kom til.
4. S6 — sikkerhetsheadere i `src/server.ts`, Report-Only først.
5. Bekreftelsessøk etter `SERVICE_ROLE` i byggresultatet.
6. Oppdater sikkerhetsminnet: S4, S5, offentlig arbeidsgiversøk, og S7-regelen om signaturendringer.

## Teknisk

- `REVOKE ALL ON FUNCTION public.<navn>(<args>) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.<navn>(<args>) TO service_role;` per signatur. For de to e-postkøfunksjonene også `GRANT EXECUTE ... TO postgres`.
- `CREATE OR REPLACE FUNCTION public.get_user_employers()` uten parameter, `WHERE user_id = auth.uid()`, deretter `DROP FUNCTION public.get_user_employers(uuid)`.
- `ALTER FUNCTION ... SET search_path = public, pg_temp` for de fire e-postkøfunksjonene.
- `src/server.ts`: `withSecurityHeaders(response)` som legger på headerne, med tidlig retur for stier som starter med `/api/public/`.
