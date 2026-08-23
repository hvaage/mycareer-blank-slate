# Jobb-Leads: steg 0-rapport og revidert byggeplan

Briefens steg 0 krever fakta om hva som allerede finnes i karrierenmin.no før noe migreres.
Dette er svarene, hentet fra kode og database i dette prosjektet. Deretter følger den justerte
byggeplanen, som er vesentlig mindre enn briefen antar, fordi flere ledd allerede er bygget her.

## Del 1 — Steg 0: faktisk tilstand (verifisert)

**`job_leads` finnes allerede, og er e-post-orientert.**
Kolonner i dag: `user_id`, `email_connection_id`, `source_message_id`, `source_email_from`,
`source_subject`, `received_at`, `posted_text`, `title`, `company`, `location`, `work_type`,
`salary_text`, `job_url`, `raw_snippet`, `ai_score`, `ai_reasoning`, `ai_match_highlights`,
`ai_concerns`, `status` (enum), `promoted_application_id`, `source_system`, `source_url_hash`,
`source_observed_at`. Tabellen er **tom (0 rader)**. Den mangler `logical_job_key`,
`qualification_status/score/reason`, `match_score/band`, `gaps`, `application_due`,
`reject_reason`, `confidence`, `raw_payload`.

**`email_connections` finnes, med kryptertoken-form** (`provider`-enum, `access_token`,
`refresh_token`, `token_expires_at`, `scopes_granted`, `status`, `last_sync_at`,
`last_synced_internal_date`). Også **tom (0 rader)**. Frontend `EmailConnections` er i dag kun
en «kommer snart»-stub. Det finnes ingen Gmail-/Graph-henting i noen edge function.
`email_job_sources` og `imported_job_emails` finnes **ikke**.

**`job-leads.tsx` leser ikke `job_leads` som hovedkilde.** Siden slår sammen tre kilder:
`list_user_job_opportunities` (RPC), `user_opportunities`, `user_job_listing_status` — og bruker
`job_leads` kun til sletting/statusoppdatering av eldre rader. Kildefiltrene i UI-et er
`linkedin`, `careerjet`, `nav`.

**NAV-katalogen er allerede i dette prosjektet, ikke bare i `norwegian-career-intelligence`.**
`source_postings` har 338 563 rader og `canonical_opportunities` 243 679, med
`sync-nav-opportunities` og `sync-careerjet-opportunities` som aktive edge functions,
pluss kanonisering, dedupnøkler (`lead_dedupe_keys`) og identitetsavstemming. Å bygge en ny
kryss-kilde-identitet fra job-buddy-db ville blitt en tredje variant — briefens 11.2-risiko er reell.

**Matchelaget finnes allerede, som versjonert kontrakt.**
`score-pending-opportunities/screening-v2.ts` gjør hardfilter + kravuttrekk
(`mandatory/preferred/context`), status `eligible/excluded/needs_review`, mot `career_atoms`,
versjonsmerket `job_match_v3_2026_08_15`. Dette dekker mye av det briefen kaller `cv-tailoring`,
og er allerede synlig i Jobb-Leads-UI-et.

**`extract-job-ad` er allerede deployert her** som egen edge function.

**Preferansefelt for qualification-laget** ligger i `user_career_profiles`:
`desired_role_types`, `desired_industries`, `preferred_locations`, `preferred_company_sizes`,
`preferred_work_styles`, `remote_preference`, `career_stage`, `leadership_level`,
`years_experience`, `salary_expectation_min/max`, `dimension_weights`.

**Konsekvens:** det som faktisk mangler er kun **e-postinntaket** (innhenting, rålagring, parsing,
konfidens) og **koblingen** fra e-post-leads inn i den eksisterende identitets-, dedup- og
screeningkjeden. Punkt 1–3 i briefens byggerekkefølge krymper tilsvarende; punkt 4 er ferdig,
og punkt 5–6 blir «koble på», ikke «bygg nytt».

## Del 2 — Revidert byggeplan

### Trinn A — Konsolider datamodellen (én migrasjon)
- Utvid `job_leads` additivt: `logical_job_key`, `reject_reason`, `parse_confidence`,
  `qualification_status`, `qualification_score`, `qualification_reason`, `application_due`,
  `raw_payload`. Match-score legges **ikke** her; den leses fra eksisterende screeninglag.
- Ny `imported_job_emails` (rå e-post per bruker, egen oppbevaringstid) og
  `email_job_sources` (kilde + søkefilter + aktiv-status), begge med
  `GRANT` → `ENABLE ROW LEVEL SECURITY` → policy scoped på `auth.uid()`.
- `logical_job_key` genereres med de **eksisterende** nøkkelfunksjonene (`normalize_lead_key`,
  `lead_dedupe_keys`), ikke med en portert kopi fra job-buddy-db.

### Trinn B — Inntak
- Gmail aktiv henting: OAuth-tilkobling, tokenkryptering, `gmail_query`-filtrert henting,
  inkrementell synk på `last_synced_internal_date`. Erstatter dagens «kommer snart»-stub.
- Videresending som fallback (iCloud m.fl.): alias-tabell som knytter en ugjettbar mottaksadresse
  til `user_id`, mottak via `/api/public/*`-rute med verifisering av avsender og alias.
- Outlook/Graph legges inn etter samme grensesnitt, men bak samme abstraksjon som Gmail.

### Trinn C — Parsing og klassifisering
- Regelbasert parser (prefilter → feltuttrekk Finn/LinkedIn inkl. digest → konfidens), uten AI.
  Manglende tittel/selskap/URL gir `rejected` + `reject_reason`, aldri tom «gyldig» rad.
- Qualification-lag leser `user_career_profiles`-feltene over. Ingen hardkodede fraser,
  stedlister eller person­spesifikke regler.

### Trinn D — Kobling til eksisterende kjede
- E-post-leads registreres i `lead_dedupe_keys` slik at de dedupliseres mot NAV/Careerjet-radene.
- Screening kjøres av eksisterende `score-pending-opportunities`-kontrakt, uten ny scoringversjon.
- Jobb-Leads-UI får e-post som fjerde kildefilter; ingen ny visningsflate.

### Trinn E — Drift og personvern
- Helsemål: andel `rejected` per `reject_reason` per kilde over tid.
- Skill «ingen nye leads» fra «innhenting nede» i status, slik driftsprinsippene krever.
- Daglig jobb setter utløpt frist til `expired`.
- Egen oppbevaringstid på rå e-posttekst; samtykketekst må si eksplisitt at lesescopet er bredere
  enn «kun jobbvarsler».

## Tekniske merknader
- Alt nytt er multi-tenant; ingen bruker­spesifikke regler.
- Ingen migrering av de 62 e-postene / 120 kandidatene fra job-buddy-db.
- `cv-tailoring` bygges ikke som en parallell matchemotor. Den semantiske utvidelsen
  (`semantic_key`/`semantic_aliases`) hører hjemme som en endring **inne i**
  `screening-v2.ts` med ny versjonsstreng, ikke som en ny pipeline.
- RLS-funnet i `norwegian-career-intelligence` (brief 11.1) gjelder et annet Supabase-prosjekt
  som ikke styres herfra, og er utenfor denne planens rekkevidde.

## Beslutninger jeg trenger svar på før bygging
1. Bygger vi Gmail-henting nå, eller kun videresendingsveien først (raskere, ingen Google-verifisering)?
2. Skal e-post-leads vises i dagens Jobb-Leads-liste (anbefalt) eller på egen flate?
