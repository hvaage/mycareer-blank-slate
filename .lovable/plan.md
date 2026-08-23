# Jobb-Leads Trinn C — lik matching for alle fire kilder

Skrivesiden bekreftes først, slik briefen ber om. Alt under er lest direkte mot databasen og
`score-pending-opportunities/index.ts`, ikke mot instruksteksten.

## Rapport før bygging: kolonner som legges til på `job_leads`

Verifisert i databasen nå: `job_leads` har `ai_score` (smallint), `ai_reasoning`,
`ai_match_highlights`, `ai_concerns` — og mangler resten. `user_opportunities` og
`user_job_listing_status` har begge de seks feltene funksjonen skriver, pluss et sjuende som
UI-et faktisk leser.

| Kolonne | Type | Kilde for typevalg |
|---|---|---|
| `screening_status` | `text` | likt begge eksisterende tabeller |
| `screening_reasons` | `jsonb` (default `'[]'::jsonb`) | likt begge |
| `requirement_summary` | `jsonb` (default `'{}'::jsonb`) | likt begge |
| `match_score_version` | `text` | likt begge |
| `match_scored_model` | `text` | likt begge |
| `ai_scored_at` | `timestamptz` | likt begge |
| `screening_evaluated_at` | `timestamptz` | finnes på begge; `job-leads.tsx` (linje 321) leser det i `screeningCols` |

Avvik som må noteres: `ai_score` er `smallint` på `job_leads` og `user_job_listing_status`, men
`numeric` på `user_opportunities`. `job_leads.ai_score` beholdes som `smallint` — scoren er
0–100 heltall, og en typeendring ville tvinge fram endringer i eksisterende V1-lesing i UI-et.
`record_job_match_evaluation()` runder derfor scoren i `job_leads`-grenen.

`qualification_status`, `qualification_score`, `qualification_reason`, `parse_confidence` og
`reject_reason` fra Trinn A er parse-kvalitet ved inntak og røres ikke.

## Migrasjon (før noe scoring-kode skrives)

1. `ALTER TABLE public.job_leads` med de sju kolonnene over. Ingen nye grants/policyer —
   tabellen har dem allerede.
2. `ALTER TABLE public.job_match_evaluations ADD COLUMN job_lead_id uuid REFERENCES
   public.job_leads(id) ON DELETE SET NULL`, med indeks på `(job_lead_id)`.
3. `CREATE OR REPLACE FUNCTION public.record_job_match_evaluation(...)` — samme signatur:
   - `p_row_kind` godtar `'job_leads'` i tillegg til `'canonical'`/`'legacy'`.
   - Ny tredje gren: `SELECT ... FROM public.job_leads WHERE id = p_row_id AND user_id =
     p_user_id FOR UPDATE`, samme `previous_result`-oppsamling og samme
     `UPDATE`-felt som de to andre grenene.
   - `INSERT INTO public.job_match_evaluations` får `job_lead_id` satt i den nye grenen og
     `NULL` i de to andre.
   Ingen endring i eksisterende oppførsel for canonical/legacy.

## Lesesiden — `loadCandidates()`

- `Candidate.row_kind` utvides til `"canonical" | "legacy" | "job_leads"`, `Candidate.source`
  til `"nav" | "careerjet" | "linkedin" | "finn"`. `Validated["source"]`-filteret utvides
  tilsvarende slik at `all` fortsatt betyr alle fire.
- Tredje gren leser `job_leads` direkte: `user_id`, `source_system IN ('linkedin','finn')`,
  `status = 'ny'` (enumet `job_lead_status` er `ny | avvist | promotert | arkivert` — de tre
  siste ekskluderes), samme `modeMatches()` som de andre grenene, og respekterer `input.limit`.
- `description` = `posted_text` når den finnes, ellers `raw_snippet`, gjennom samme
  `cleanText(..., DESC_MAX_LEN)`. `description_complete` settes `true` bare når `posted_text`
  har innhold; `raw_snippet` alene gir `false`, som utløser den eksisterende
  `insufficient_job_text`-regelen i `screening-v2.ts`. Ingen ny håndtering.
- `user_opportunity_id`, `listing_status_id`, `canonical_opportunity_id`, `listing_id` er
  `null` for denne grenen.
- `syncRequirementAtoms()` returnerer tidlig når `scopeId` er `null`, så kravsatomer skrives
  ikke for e-postleads. Det er riktig i denne omgangen: `opportunity_requirement_atoms` har
  ingen `job_lead_id`-kolonne, og briefen ber ikke om en. Noteres som kjent avgrensning.

## `lead_dedupe_keys` ved innhenting — alle fire kilder

`register_lead(p_user_id, p_source, p_priority, p_dedupe_key, p_ref_table, p_ref_id)` finnes
og brukes i dag av `fetch-careerjet-listings` (linje 615) samt reaktivt fra `job-leads.tsx`
(linje 715) og `applications/new.tsx`. Nøkkel bygges med `normalize_lead_key(p_url, p_company,
p_title, p_location)`.

- E-postinntaket (`src/lib/job-leads/ingest.ts`) kaller `register_lead` rett etter at
  `insert_job_lead_dedup` har returnert en rad, med `ref_table='job_leads'` og
  kilde/prioritet per `source_system`.
- `sync-nav-opportunities` får samme registrering ved innhenting, med
  `ref_table='user_opportunities'`.
- `fetch-careerjet-listings` har den allerede — den kontrolleres mot samme nøkkelform
  (`cmp:`-varianten) og endres bare hvis den avviker.
- Reaktiv registrering ved avvisning/promotering beholdes uendret; den nye er additiv.

## Verifikasjon før rapport

1. `read_query`: de sju kolonnene finnes på `job_leads`, `job_lead_id` på
   `job_match_evaluations`, og funksjonsdefinisjonen inneholder `'job_leads'`.
2. Faktisk kjøring av `score-pending-opportunities` med `dry_run=false` mot en test-lead fra
   e-postinntaket: bekreft at `screening_status`, `match_score_version` og `ai_scored_at`
   settes på raden, og at det finnes én rad i `job_match_evaluations` med `job_lead_id` satt.
3. Kryssbruker: kall med bruker B mot bruker A sin lead-id skal ikke oppdatere noen rad.
4. Regresjon: rescore av én NAV- og én Careerjet-rad gir samme status/score som før
   migrasjonen.
5. `lead_dedupe_keys`: rad registreres ved innhenting for e-post og NAV, ikke bare ved
   avvisning.

## Uendret

Samme `initialScreening()` og AI-evaluering for alle fire kilder. Ingen ny visningslogikk i
`job-leads.tsx` utover å lese de nye feltene for e-postleads gjennom samme
`ACCEPTED_MATCH_SCORE_VERSIONS`-kontrakt som NAV/Careerjet.
