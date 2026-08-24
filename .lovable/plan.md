# Sikkerhetsgrunnlag før CASA — verifisert mot vår egen database

Jeg har kjørt kontrollene direkte mot databasen denne appen faktisk bruker (ikke job-buddy-db). Bildet er annerledes enn i instruksen: de to «akutte lekkasjene» finnes ikke her, men fire andre åpne funksjoner gjør det.

## Hva som IKKE gjelder oss (verifisert)

- `cv_dekningsgrad` finnes ikke i denne databasen.
- `employer_profile` finnes ikke.
- `seed_default_email_job_sources` finnes ikke.
- Ingen visning mangler `security_invoker` — det finnes null slike visninger i `public`.
- `sync_user_opportunity_ai_from_legacy`, `refresh_company_aggregate` og `refresh_company_process_aggregate` er ikke kallbare av verken anonyme eller innloggede brukere i dag.
- Hemmeligheter: `SUPABASE_SERVICE_ROLE_KEY` leses kun via `process.env` i server-filer, som beskrevet. Ingen endring — bare bekreftelsessøket i byggresultatet.

## Funn som faktisk gjelder oss

### S1 — Åpne skrivefunksjoner uten innloggingskrav (høyest prioritet)

Fire funksjoner kan kalles av uinnloggede besøkende og gjør skriveoperasjoner uten å sjekke hvem som kaller:

- `insert_job_lead_dedup(jsonb)` — kan legge inn jobb-leads på en vilkårlig bruker-ID utenfra.
- `email_queue_dispatch()` — kan trigge utsending fra e-postkøen utenfra.
- `internal_ai_generation_commit_step(...)` — intern arbeiderfunksjon for KI-generering; skriver innhold til genereringsjobber.
- `brreg_full_merge(...)` og `brreg_full_apply_refined_filter(...)` — interne registerimport-funksjoner.

Rettelse: trekk tilbake kjøretilgang for `anon`, `authenticated` og `PUBLIC` på alle fem, og gi kun `service_role`. De kalles fra serversiden (edge-funksjoner / serverfunksjoner) med tjenestenøkkel, så appen påvirkes ikke.

### S2 — `get_user_employers(p_user_id)`: innlogget bruker kan lese andres arbeidsgiverhistorikk

Funksjonen er `SECURITY DEFINER`, kallbar av innloggede (ikke anonyme), og har ingen `auth.uid()`-sjekk — den stoler på parameteren. En innlogget bruker kan derfor spørre om hvilke selskaper en annen bruker har søkt hos eller vurdert.

Rettelse: fjern parameteren og bruk `auth.uid()` direkte, slik at feilklassen blir strukturelt umulig. Kallstedene i koden oppdateres i samme runde.

### S3 — Fire funksjoner mangler fast søkevei

`delete_email`, `enqueue_email`, `move_to_dlq`, `read_email_batch` mangler `SET search_path`. Lav risiko, billig å rette: legg til `SET search_path = public, pg_temp`.

### S4 — 14 tabeller har radsikkerhet på uten noen regel

`careerjet_*`-tabellene, `cv_generation_jobs`, `lead_events`, `source_company_resolutions`, skrivelåser m.fl. Dette er ikke en lekkasje — ingen når dem via API-et i dag. De er driftstabeller som kun serversiden bruker, så dette er tilsiktet. Jeg dokumenterer det i sikkerhetsminnet i stedet for å endre noe.

### S5 — `pg_trgm` og `vector` ligger i public-skjemaet

Anbefalt flyttet til `extensions`. Dette er en risikofylt flytting (indekser og funksjonssignaturer på arbeidsgiversøket peker på operatorklasser derfra) med svært lav gevinst. Forslag: la det stå, noter som bevisst valg.

### S6 — Sikkerhetsheadere (CSP m.m.)

Ingen headere settes i dag. Alt går gjennom `fetch()` i `src/server.ts`, så headerne legges på der — ingen ekstra CDN-lag.

- `Content-Security-Policy-Report-Only` først, satt sammen etter en faktisk gjennomgang av hva appen laster (backend-URL for `connect-src`, skriftkilder, bilder, `frame-ancestors 'none'`). Håndheving først etter at Report-Only har vært stille.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` som slår av kamera/mikrofon/geolokasjon, `X-Frame-Options: DENY`.
- Headerne settes ikke på `/api/public/*`-ruter som eksterne tjenester kaller.

Merk: appen kjøres også i en forhåndsvisning inne i en iframe i byggeverktøyet. `frame-ancestors 'none'` slås derfor kun på for det publiserte domenet, ikke i forhåndsvisning.

### S7 — Fast sikkerhetssjekk etter databaseendringer

Jeg kjører databaselinteren etter hver migrasjon fra nå av, og rapporterer nye funn i samme svar.

## Rekkefølge

1. Én migrasjon som dekker S1, S2 og S3, pluss kodeendring på kallstedene til `get_user_employers`.
2. Kjør linter og bekreft at funnene er borte.
3. Sikkerhetsheadere i `src/server.ts` (S6), Report-Only først.
4. Bekreftelsessøk etter `SERVICE_ROLE` i byggresultatet, og kontroll av at nøkler ikke ligger i versjonshistorikken.
5. Oppdater sikkerhetsminnet med de bevisste valgene (S4, S5, offentlig arbeidsgiversøk).

## Teknisk

- Migrasjon: `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;` for de fem funksjonene i S1. `CREATE OR REPLACE FUNCTION public.get_user_employers()` uten parameter, filtrert på `auth.uid()`, gammel signatur droppes. `ALTER FUNCTION ... SET search_path = public, pg_temp` for de fire e-postkøfunksjonene.
- `src/server.ts`: en `withSecurityHeaders(response)` som klonerer responsen og legger på headerne, brukt på returverdien fra `normalizeCatastrophicSsrResponse`.
