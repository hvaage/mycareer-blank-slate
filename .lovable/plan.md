# Jobb-Leads Trinn E2 — URL/tekst/PDF-import med samlet import-/parse-/match-kontrakt

Brukeren kan legge inn en stillingsannonse (URL, limt tekst eller PDF) direkte på Jobb-Leads-siden. Frontend kaller **kun** `importManualJobLead` — én sammenhengende operasjon som internt henter/leser, parser, lagrer/dedupliserer og scorer, og returnerer et samlet resultat. Ingen egen «Vurder»-knapp etterpå. `extract-job-ad` kalles aldri fra klienten.

Verifisert mot live DB og kode før planlegging:

- `job_leads` har alle nødvendige kolonner (`source_system`, `source_url_hash`, `raw_payload`, `posted_text`, `screening_status`, `match_score_version`, `ai_score`, m.fl.) og `job_leads_source_url_hash_idx` er `UNIQUE (user_id, source_system, source_url_hash) WHERE source_url_hash IS NOT NULL`.
- Lokal generert type (`types.ts`) dekker alle disse kolonnene — ingen regenerering nødvendig (punkt 3).
- `insert_job_lead_dedup(jsonb)` er `service_role`-only, og returnerer i dag `(NULL, false)` ved duplikat — eksisterende rad-id returneres ikke (verifisert i migrasjon `20260823220302`).
- `insert_job_lead_dedup`s dedup-kontrakt er `ON CONFLICT (user_id, COALESCE(job_url,''), COALESCE(title,''), COALESCE(company,'')) DO NOTHING`; i tillegg finnes `job_leads_source_url_hash_idx UNIQUE (user_id, source_system, source_url_hash) WHERE source_url_hash IS NOT NULL`.
- `register_lead(p_user_id, p_source text, ...)` har ingen kilde-begrensning — `p_source` er fri tekst (verifisert i migrasjon `20260529130422`), så `manual_url`/`manual_paste` kan brukes direkte.
- `validateIds` i `score-pending-opportunities` avviser allerede id-lister over 20 — den grensen beholdes uendret (justering 1).
- `record_job_match_evaluation` støtter allerede `job_leads` (migration `20260824081559`).
- `score-pending-opportunities` utleder `userId` fra `Authorization`-headeren — serverfunksjonen må videresende brukerens bearer-token.
- `src/start.ts` registrerer prosjektets `attachSupabaseAuth` som `functionMiddleware` — bearer legges ved automatisk.
- `src/lib/job-leads/ingest.ts` eier i dag innsettings-mønsteret via `insert_job_lead_dedup` + `register_lead` — trekkes ut til delt helper uten logikkendring.

## Endringer

### 1. Migrasjon: `insert_job_lead_dedup` returnerer eksisterende rad ved duplikat (justering 2)
- `CREATE OR REPLACE FUNCTION public.insert_job_lead_dedup(jsonb)`: ved konflikt hentes den eksisterende radens id med **samme predikat som konflikt-klausulen** (`user_id` + `COALESCE(job_url,'')`/`title`/`company` mot payload-verdiene, `LIMIT 1`) og returneres som `(lead_id, false)`. Ny rad returnerer som i dag `(id, true)`.
- Signaturen (jsonb inn, samme returkolonner) er uendret, men per sikkerhetsregel 1 inkluderer migrasjonen likevel `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE ... TO service_role` på nytt i samme migrasjon. `SET search_path = public` beholdes.
- Ingen app-side gjetting av duplikat-rad: serverfunksjonen bruker alltid den returnerte id-en, og henter eksisterende rads status/screeningfelt deterministisk med `eq(user_id)` + `eq(id)`.

### 2. `supabase/functions/score-pending-opportunities/index.ts` — målrettet `job_leads`-scoring
- `Validated` får `job_lead_ids: string[]`; `validateInput` parser dem med samme `validateIds` (**uendret grense: maks 20 id-er per liste**, kombinert total-guard uendret). `importManualJobLead` sender alltid nøyaktig én id.
- `targeted` utvides til å inkludere `job_lead_ids.length > 0`.
- `job_leads`-bransjen i `loadCandidates`: når `job_lead_ids` er satt, velges rader med `.in("id", job_lead_ids)` **uten** status-/qualification-filtre, slik at både nye rader (`status = 'ny'`) og eksisterende duplikatrader med annen status kan scores målrettet. Uten `job_lead_ids` er dagens filtre uendret.
- `Candidate["source"]`-typen utvides med `manual_url | manual_paste`.

### 2. `src/lib/job-leads/insert-job-lead.server.ts` (ny) + refaktor av `ingest.ts`
- Delt helper `insertJobLeadDeduped(admin, payload)` (RPC-kall + `wasInserted`) og `registerLeadForUser(admin, ...)` (`normalize_lead_key` + `register_lead`).
- `ingest.ts` bruker helperen — identisk oppførsel for e-postinntak.

### 3. `src/lib/job-leads/import.functions.ts` (ny) — `importManualJobLead` (punkt 1, 2, 6, 7)
`createServerFn` + `requireSupabaseAuth`. Input: `{ jobUrl, rawText, inputKind: 'url' | 'pdf_text' | 'paste' }` (Zod `.strict()`).

Handler-flyt:
1. Leser `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` inne i handleren.
2. Kaller `extract-job-ad` internt med `apikey`-header (`{ url }` eller `{ text }`) — aldri et `extracted`-objekt fra klienten. Feiler parsingen, kastes feil med norsk melding. Mangler stillingstittel i resultatet, avvises importen.
3. Bygger payload (`source_system = 'manual_url'` når `jobUrl` finnes, ellers `'manual_paste'`; `raw_payload` inneholder `extraction_method: 'manual'`, `input_kind`, `url`; `raw_snippet` fra `raw_text.slice(0, 400)`).
4. Lagrer via `insertJobLeadDeduped` (admin inne i handler). Ved ny rad: `registerLeadForUser` (kilde `other`, prioritet 1).
5. Ved duplikat: deterministisk, brukeravgrenset oppslag som speiler konflikt-predikatet (`user_id` + `job_url`/`title`/`company` med null-semantikk) for å hente eksisterende rads id, status og screeningfelter (punkt 7).
6. Scoring: leser `Authorization`-headeren fra innkommende request (`getRequestHeader`) — finnes den ikke, returneres `scoringCompleted: false` med eksplisitt feil (punkt 2). Kaller `score-pending-opportunities` med `{ source: "all", mode: "stale", limit: 1, job_lead_ids: [leadId] }` og brukerens bearer + `apikey`.
7. Resultatvurdering (punkt 6): finner radens resultat i `results`. Returneres `selected = 0`/`evaluated = 0` eller raden er i `failures`, settes `scoringCompleted: false` med `scoringError` — aldri stille suksess. Unntak: duplikat som allerede har V2-screening returnerer eksisterende `screening_status`/`ai_score`.
8. Returnerer DTO: `{ leadId, wasInserted, duplicateStatus, scoringCompleted, screeningStatus, score, scoringError }`.

### 4. `src/routes/_authenticated/job-leads.tsx` — UI + eksplisitt leseside (punkt 4)
- Ny lukkbar seksjon «Legg til annonse selv» under sidetittelen: URL-felt, PDF-opplasting (klient-side tekstuttrekk med `pdfjs-dist`, dynamisk import — samme mønster som `applications/new.tsx`), tekstområde og én knapp «Legg til og vurder». Knappen kaller kun `importManualJobLead` og viser én samlet toast («Lagt til og vurdert: Relevant (78)» / «Ligger allerede i listen (status: ny)» / lagret-men-scoring-feilet med `scoringError`).
- `rawLeads`-mapping utvides eksplisitt: `source_system = 'manual_url'|'manual_paste'` skilles fra LinkedIn-rader, mappes til `finn` (når `job_url`-host er finn.no) ellers `other`, og behandles som **V2-rader** med `screening_status`, `screening_reasons`, `requirement_summary`, `match_score_version` og `ai_score` fra raden. LinkedIn V1-logikk (`isLinkedInAiEvaluated`) brukes kun på LinkedIn-rader.
- `Lead`-typen får `fromJobLeads: boolean` og `manual?: boolean`; alle rader fra `job_leads`-spørringen får `fromJobLeads: true`.
- Skriveveier korrigeres til å bruke `fromJobLeads` i stedet for kilde-sjekk: `tombstoneDedupe` (`p_ref_table = "job_leads"`) og promotering (sletting fra `job_leads`) treffer da også finn/other/manuelle rader — i dag havner e-post-finn/other-rader feilaktig i Careerjet-grenen.
- Kilde-filteret: «Annen e-post» omdøpes til «Annet / manuelt» (Finn.no finnes allerede). Kort-visningen får etikett «Lagt inn manuelt» for manuelle rader.
- Etter import: `invalidateQueries` på `["job-leads-linkedin"]` (job_leads-feeden).

### 5. Verifisering (punkt 5)
- Deploy av edge-funksjonen.
- Test av `importManualJobLead` ende-til-ende: ny rad (`status = 'ny'`) og gjentatt import av samme annonse (duplikat med endret status) — begge skal gi `scoringCompleted: true` eller eksplisitt feil.
- Byggsjekk via build-loggen.

## Tekniske detaljer
- `importManualJobLead` er en tynn wrapper: modul-scope kun imports, typer og selve deklarasjonen; Zod-skjema i `inputValidator`; admin-klient og helper lastes med dynamisk import inne i handleren.
- Ingen nye tabeller eller migrasjoner. RLS uendret: skriving går via `service_role`-RPC etter autentisering; lesing i UI bruker eksisterende RLS-policyer.
- `supabase/functions/` brukes fordi `score-pending-opportunities` og `extract-job-ad` allerede er edge functions; endringen er minimal og bakoverkompatibel (`job_lead_ids` er valgfritt).

## Eksplisitt utenfor scope (punkt 8)
- NAV-speil, Enhetsregister/Regnskapsregister-speil og ESCO-speil: ingen endringer i speil, sync-jobber, repair/backfill, lifecycle eller databevaring.
- Ingen endring i e-postinntakets oppførsel (kun intern helper-uttrekking).
- Automatisk promotering til Søknader er ikke del av denne runden.
