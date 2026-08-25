# Jobb-Leads Trinn E2 — URL/tekst/PDF-import med scoring i én operasjon

## Mål

Brukeren legger inn en stillingsannonse fra URL, PDF eller limt tekst direkte på Jobb-Leads-siden. Én sammenhengende flyt: hent/les → parse → lagre/dedupliser → score → ferdig resultat i frontend. Frontend gjør nøyaktig étt backend-kall (`importManualJobLead`). Ingen etterfølgende «Vurder nye og utdaterte»-trykk.

Ikke i scope: NAV-speil, Enhetsregister/Regnskapsregister-speil, ESCO-speil, deres sync-jobber, repair/backfill og databevaringslogikk. Ingen sletting av annonser eller historikk. Lønnsmatching (ESCO/SSB) er et senere tema.

## Verifiserte backend-kontrakter (sjekket mot live DB og kode)

- `job_leads`-kolonner finnes alle: `source_system` (text), `source_url_hash` (text), `raw_payload` (jsonb), `qualification_status` (text), `qualification_score` (smallint), `posted_text`, `raw_snippet`, `job_url`, `application_due`, `parse_confidence`, `status` (enum).
- `job_leads_source_url_hash_idx`: UNIQUE på `(user_id, source_system, source_url_hash) WHERE source_url_hash IS NOT NULL` — verifisert live.
- `insert_job_lead_dedup(jsonb)` finnes, er SECURITY DEFINER med `search_path = public`, og er kun `service_role`. **Funksjonen endres ikke** — da slipper vi revoke/grant-regelen.
- `record_job_match_evaluation` støtter `p_row_kind = 'job_leads'` og skriver screening-kolonner på `job_leads` (migrasjon 20260824081220).
- `score-pending-opportunities` henter bruker fra Authorization-header (linje 893) og har allerede `job_leads`-grenen i `loadCandidates` (linje 510–559). Targeted-modus hopper i dag **over** `job_leads` (`!targeted`, linje 513) — dette hullet lukkes i steg 1.
- Mode `stale` scorer rader uten gjeldende `MATCH_SCORE_VERSION` — en ny importert rad scores derfor automatisk.
- `normalize_lead_key` og `register_lead` er kallbare og brukes allerede fra klient og `ingest.ts`.
- `extract-job-ad` er `verify_jwt = false` og kan kalles internt over HTTP fra serverfunksjonen med `SUPABASE_URL` + publishable key som `apikey`. **Ingen endring i funksjonen** — den inneholder allerede URL-henting, fallback-melding for sider bak innlogging og all promptlogikk.

## Steg 1 — Utvid score-pending-opportunities med job_lead_ids-treffstyring

Liten, bakoverkompatibel utvidelse av `supabase/functions/score-pending-opportunities/index.ts`:

- `Validated` får `job_lead_ids: string[]` (gjenbruker `validateIds`, totalgrense 20 ids beholdes).
- `targeted` utvides til å inkludere `job_lead_ids`.
- `job_leads`-grenen: betingelsen endres fra `!targeted` til `(!targeted || input.job_lead_ids.length > 0)`. Når `job_lead_ids` er satt: `.in("id", ids)` + `.eq("user_id", userId)`, og status-/qualification-filtrene (`in("status",["ny"])`, qualification-or) hoppes over — slik at både nye rader og eksisterende duplikatrader (som kan ha annen status) faktisk scores ved treffstyrt kall.
- `Candidate["source"]`-typen utvides med `"manual_url" | "manual_paste"` (kun type — ingen logikk i screening-v2.ts avhenger av disse verdiene).
- Deployes med supabase--deploy_edge_functions og testes med curl_edge_functions (ny rad og eksisterende rad med annen status — begge skal returnere faktisk `screening_status`).

## Steg 2 — Én backend-kontrakt: importManualJobLead

Ny tynn wrapper `src/lib/job-leads/import.functions.ts` — `createServerFn({ method: "POST" })` med `requireSupabaseAuth`. Dette er den eneste handlingen frontend kaller.

Input (zod, strenge felt — ingen `extracted` fra klient):

```text
{ jobUrl: string | null, rawText: string | null, inputKind: "url" | "pdf_text" | "paste" }
```

Handleren gjør hele flyten:

1. **Hent/les + parse internt**: kall `POST {SUPABASE_URL}/functions/v1/extract-job-ad` med `{ url: jobUrl }` når URL finnes, ellers `{ text: rawText }`. `apikey: SUPABASE_PUBLISHABLE_KEY`, miljøvariabler lest inne i handleren. Ved 400 (hentefeil/innenloggingsside): kast feilen videre med funksjonens egen fallback-melding («Lim inn annonseteksten manuelt eller last opp PDF») — **ingen lead opprettes**. Klienten står aldri fritt til å påvirke lagringen; `extracted` kommer utelukkende fra dette interne kallet.
2. **Lagre/deduplisere**: `source_system = jobUrl ? "manual_url" : "manual_paste"`, `source_url_hash = sha256(jobUrl)` ved URL, `posted_text`/`raw_snippet = extracted.ad_markdown ?? raw_text`, `qualification_status = "qualified"`, `qualification_score = NULL` (importkvalifisering, aldri match-score). Felter fra `extracted` + hele objektet i `raw_payload`. Insert via `insert_job_lead_dedup` med `await import("@/integrations/supabase/client.server")` inne i handleren. Felles hjelper trekkes ut av `ingest.ts` til `insert-job-lead.server.ts` (ingen logikkendring for e-post).
3. **Dedupe-registrering**: ved ny rad, `normalize_lead_key` + `register_lead` (prioritet 1) — samme mønster som `ingest.ts`.
4. **Duplikat**: RPC-en returnerer `lead_id = NULL, was_inserted = false` ved konflikt. Handleren henter da eksisterende rad (`user_id` + `source_url_hash`, eller url/tittel/selskap ved tekst-uten-URL) og bruker dens id videre.
5. **Scoring i samme handler**: kall `POST {SUPABASE_URL}/functions/v1/score-pending-opportunities` med brukerens videresendte bearer-token (`getRequestHeader("authorization")`) og body `{ source: "all", mode: "stale", limit: 1, job_lead_ids: [leadId] }`. Les `results[0]` for `screening_status`/`score` og `failures` for vurderingsfeil. Gjelder både nye rader og duplikater som mangler gjeldende score.
6. **Samlet respons**:
   - Ny + scoret: `{ leadId, wasInserted: true, scoringCompleted: true, screeningStatus, score }`
   - Duplikat: `{ leadId, wasInserted: false, scoringCompleted, screeningStatus, score }` (eksisterende eller oppdatert)
   - Import OK, scoring feilet: `{ leadId, wasInserted, scoringCompleted: false, scoringError }` — rapporteres aldri som full suksess
   - Hente-/parsefeil: kastet feil med fallback-melding, ingen lead opprettet

## Steg 3 — Frontend: én knapp, én lastetilstand

I `job-leads.tsx`:

- Collapsible-seksjon «Legg til annonse selv» ved siden av «Hent og vurder nye annonser»:
  1. URL-felt
  2. PDF-opplasting med klientside tekstuttrekk via `pdfjs-dist` (PDF forlater aldri nettleseren — samme kode som `applications/new.tsx`; uttrukket tekst sendes som `rawText` med `inputKind: "pdf_text"`)
  3. Tekstområde for limt annonsetekst (`inputKind: "paste"`)
- Én knapp «Analyser og legg til» → kaller kun `importManualJobLead` via `useServerFn`. Ingen separat `extract-job-ad`-kall fra klienten, ingen mellomliggende «analysert»-visning.
- Resultatmeldinger (du-form):
  - Ny + scoret: toast med match-resultat («Høy match · 78», «Må vurderes», «Ikke relevant»)
  - Duplikat: «Denne annonsen ligger allerede i listen din» + eksisterende/oppdatert status
  - Import OK, scoring feilet: advarsel «Annonsen er lagret, men vurderingen feilet — prøv «Hent og vurder» senere»
  - Hente-/parsefeil: feilmeldingen fra backend (fallback-teksten om å lime inn tekst/PDF)
- Invalider `["job-leads-linkedin", user.id]` etter fullført operasjon.
- UI viser aldri «vurdert» uten `scoringCompleted: true`.

## Steg 4 — Leseside: kildeavledning og filter

I `rawLeads`-mappingen (ca. linje 365), kun fordi backend nå skriver stabile `source_system`-verdier:

- `manual_url` med `job_url`-vert som inneholder `finn.no` → kilde `"finn"` (den eksisterende Finn-filterverdien får treff).
- Øvrige `manual_url`/`manual_paste` (dnjobb.no, selskapssider, ren tekst) → `"other"`.
- Badge: «Finn.no» / «Lagt inn manuelt».
- Disse radene behandles som V2-rader (screening-felter), ikke V1/LinkedIn-logikk.

## Rekkefølge

Steg 1 + 2 (backend-kontrakt) → steg 3 (frontend) → steg 4 (filter/leseside).

## Verifikasjon før PASS

- Finn.no-URL: étt kall til `importManualJobLead` → parsed, lagret og scoret, badge viser reelt resultat.
- Samme URL på nytt: duplikatmelding, ingen ny rad, eksisterende/oppdatert status returnert.
- Duplikatrad med annen status enn `ny`: treffstyrt scoring via `job_lead_ids` scorer den likevel (testet via curl_edge_functions).
- Limt tekst uten URL: `source_system = manual_paste`, scores i samme operasjon.
- PDF: tekstuttrekk i nettleser, samme `importManualJobLead`-kontrakt med `inputKind: "pdf_text"`.
- Manipulasjonstest: klient kan ikke sende `extracted` — inputvalideringen avviser ukjente felt, og lagrede felter stammer kun fra det interne extract-kallet.
- Simulert scoringfeil: lead lagret, UI viser delvis suksess med tydelig vurderingsfeil.
- Ingen rader slettes; `raw_payload` og kildefelt bevart.
- Build OK (build-errors.log), edge function deployet.

## Forbehold

Finn.no/dnjobb.no er testet fra brukerens økt, ikke fra serverens kjøremiljø. Eventuell bot-/rate-beskyttelse viser seg som vanlig hentefeil med eksisterende fallback-melding. Rapporter gjentatte feil fra én kilde — da legger vi inn kildespesifikk melding, ikke ny arkitektur.
