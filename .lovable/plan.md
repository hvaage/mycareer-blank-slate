# Jobb-Leads Trinn E2 — URL/tekst/PDF-import på Jobb-Leads-siden

## Mål

Brukeren kan lime inn URL, annonsetekst eller laste opp PDF direkte på Jobb-Leads-siden. Annonsen analyseres med eksisterende `extract-job-ad` (uendret), skrives til `job_leads` med korrekt dedup, og scores i samme operasjon.

Verifisert utgangspunkt:
- `extract-job-ad` er `verify_jwt = false` og kan kalles fra klienten som i dag (samme mønster som `applications/new.tsx`).
- `insert_job_lead_dedup(jsonb)` er kun `service_role` (revoket fra PUBLIC/authenticated i sikkerhetsherdingen). Manuell import må derfor gå via en serverfunksjon med `requireSupabaseAuth` + `supabaseAdmin` inne i handleren.
- `normalize_lead_key` og `register_lead` er allerede kallbare fra klient (brukes i `applications/new.tsx` og `job-leads.tsx`).
- `job_leads`-rader leses i `job-leads.tsx` via `linkedinLeads`-spørringen; `source_system` mappes direkte til `LeadSource` (linje 365), så `manual_url`/`manual_paste` må mappes til `finn`/`other` på lesesiden.
- `job_leads_source_url_hash_idx` (unique) finnes for URL-basert dedup.

## Steg 1 — Serverfunksjon for manuell import

Ny fil `src/lib/job-leads/import.functions.ts` (tynn wrapper):

- `importManualJobLead` = `createServerFn({ method: "POST" })` med `requireSupabaseAuth`.
- Input (zod): `{ extracted: object, rawText: string, jobUrl: string | null }`.
- Handler:
  - `source_system = jobUrl ? "manual_url" : "manual_paste"`.
  - `source_url_hash = sha256(jobUrl)` når URL finnes.
  - `posted_text` og `raw_snippet` = `extracted.ad_markdown ?? rawText` (samme felt screening-v2 leser for `insufficient_job_text`).
  - `qualification_status = "qualified"`, `qualification_score = 100` — brukeren har selv valgt annonsen.
  - Felter fra `extracted`: title, company, location, work_type, salary, application_deadline (+ hele `extracted` i `raw_payload`).
  - `await import("@/integrations/supabase/client.server")` inne i handleren; kall `insert_job_lead_dedup` (håndterer både URL-hash-indeks og ON CONFLICT på url/tittel/selskap).
  - Ved ny rad: `normalize_lead_key` + `register_lead` (kilde `manual_url`/`manual_paste`, prioritet 1) — samme mønster som `ingest.ts`.
  - Returner `{ leadId, wasInserted }` — ved duplikat vises «Denne annonsen ligger allerede i listen din».

Felles hjelper: trekk «insert via RPC + register_lead»-logikken ut av `ingest.ts` til en `insert-job-lead.server.ts` som både e-postinntaket og den nye serverfunksjonen bruker (ingen logikkendring for e-post).

Ingen ny tabell, ingen ny migrasjon, ingen nye grants — RPC-en er allerede `service_role`, og serverfunksjonen verifiserer innlogget bruker før admin-klienten brukes.

## Steg 2 — UI: tre-veis inntak på Jobb-Leads-siden

I `job-leads.tsx`, ved siden av «Hent og vurder nye annonser»:

- Ny collapsible-seksjon «Legg til annonse selv» med tre inndata (samme mønster som `applications/new.tsx`):
  1. URL-felt
  2. PDF-opplasting — klientside tekstuttrekk via `pdfjs-dist` (PDF forlater aldri nettleseren; kun uttrukket tekst sendes)
  3. Tekstområde for limt annonsetekst
- Knapp «Analyser og legg til»: kaller `extract-job-ad` via `supabase.functions.invoke` (uendret funksjon), deretter `importManualJobLead`.
- Fallback ved hentefeil (LinkedIn o.l. bak innlogging): eksisterende feilmelding fra `extract-job-ad` vises; brukeren limer inn tekst i stedet. Ingen kildespesifikk kode.
- Etter vellykket import: invalider `["job-leads-linkedin"]`-spørringen og kjør eksisterende `handleScorePending()` slik at den nye annonsen scores i samme operasjon (brukerens tidligere tilbakemelding: vurdering skal skje i samme steg som innhenting).
- Tekst på du-form («Legg til annonsen din», «Vi fant ikke…»), ikke «kandidaten».

## Steg 3 — Leseside: kildeavledning og filter

I `rawLeads`-mappingen (job-leads.tsx, ca. linje 365):

- `manual_url` med `job_url`-vert som inneholder `finn.no` → `LeadSource = "finn"` (kobler opp den eksisterende Finn-filterverdien som i dag aldri treffer).
- Øvrige `manual_url`/`manual_paste` (dnjobb.no, selskapssider, ren tekst) → `"other"`.
- Badge-etikett: «Finn.no» for finn, «Lagt inn manuelt» for other fra manuell import.
- `aiEvaluated`-logikken for disse radene: behandles som V2-rader (screening-felter), ikke V1/LinkedIn — settes i samme mapping.

## Rekkefølge

1. Steg 1 + 2 i én runde (funksjonell import → riktig datamodell → dedup).
2. Steg 3 (filter/leseside) som mindre justering rett etter.

## Verifikasjon

- Manuell import av en Finn.no-URL: rad dukker opp i Jobb-Leads med kilde «Finn.no», filteret «Finn.no» treffer.
- Samme URL på nytt: duplikatmelding, ingen ny rad (sjekk `wasInserted = false`).
- Limt tekst uten URL: `source_system = manual_paste`, rad under «other».
- Etter import er annonsen V2-scoret (badge viser match, ikke «Ikke vurdert»).
- Bygg OK i build-errors.log.

## Forbehold

Finn.no/dnjobb.no ble testet fra brukerens økt, ikke fra serverens kjøremiljø. Eventuell bot-/rate-beskyttelse vil vise seg som vanlig hentefeil med eksisterende fallback-melding — rapporter gjentatte feil fra én kilde så legger vi inn kildespesifikk melding.

## Ikke i scope

- Lønnsmatching mot ESCO/SSB (senere tema).
- Endringer i `extract-job-ad`.
