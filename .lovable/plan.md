# Fase 2 — LinkedIn-import: isolert importlag, staging og valideringsporter

Backend-only. Ingen brukerflate, ingen AI, ingen skriving til produktdata
(`profiles`, `user_career_profiles`, `career_atoms`, `career_atom_links`, `contacts`,
`job_leads`, `user_opportunities`, `job_applications`, `documents`,
`cv_claim_attestations`, preferansetabeller). Bygges ikke på `cv_imports` eller
`cv_parse_candidates`.

## Avvik mot kontrakten som må avklares/låses først

1. **ZIP-retention:** kontrakten §6.1 sier maks 30 dager, oppdraget sier maks 7 dager.
   Planen bruker **7 dager** (strengest vinner) og kontraktdokumentet oppdateres i
   samme leveranse så de ikke motsier hverandre.
2. **Feltnavn:** kontrakten §9.4 kaller feltet `duplicate_of_import_id`, oppdraget
   `canonical_import_id`. Planen bruker **`canonical_import_id`** og retter §9.4.
3. Alt annet (grenser i §8.1, statusmaskin §1.3, formål §7, klasse A/B/C §2.5,
   parserregel `connections_csv_preamble_v1` §8.5.1) implementeres uendret fra
   kontrakten; ingen nye grenseverdier oppfinnes i kode.

## 1. Migrasjoner (additive)

Én migrasjon per logisk bolk, alle med `GRANT` + RLS i samme fil.

- `linkedin_imports` — id, user_id, `archive_sha256`, `content_manifest_hash`,
  `contract_version`, `status` (CHECK mot de ni kontraktstatusene),
  `canonical_import_id`, `error_code`, `error_summary` (sanitert),
  tidsstempler (`created_at`, `validated_at`, `staged_at`, `cancelled_at`, `purged_at`),
  tellefelt (`known/unknown/excluded/valid/invalid_file_count`, `staged_record_count`,
  aggregert klasse C-eksklusjonsteller per årsak som `jsonb` med kun kodenøkler).
  Unik indeks `(user_id, archive_sha256)`.
  Driftsfelt: `active_phase` (`validation|staging|null`), `attempt_id`,
  `heartbeat_at`, `staging_started_at`.
  **Statusklassifisering:** `uploaded`, `validating` er i arbeid; `validated` og
  `partially_validated` er ikke terminale — de er klare for staging;
  `staged` er mellomtilstand mot avstemming; `reconciliation_ready` er terminal for
  fase 2; `rejected`, `cancelled`, `failed` er terminale forsøkstilstander.
  Nytt forsøk etter `failed`/`cancelled` skjer aldri ved å fortsette den gamle raden:
  serverhandlingen starter et nytt `attempt_id`, nullstiller tellefelt og fjerner
  koblinger/stagingrader fra det feilede forsøket (kun de uten andre importreferanser,
  se `linkedin_import_stage_records`) — idempotent på `(user_id, archive_sha256)`.
  **Staging-overgang uten misvisende status:** under staging beholdes `status` som
  `validated`/`partially_validated`; kun `active_phase = 'staging'`,
  `staging_started_at`, `attempt_id` og `heartbeat_at` settes. Filstatus og tellefelt
  oppdateres transaksjonelt per fil/porsjon. Når alle valgte filer er staged:
  `active_phase = null` og `status = staged`, deretter `reconciliation_ready`.
  Stale-run-opprydding bruker `active_phase` + `heartbeat_at` + `attempt_id`, setter
  `active_phase = null` og `error_code = staging_timeout`, og gjør aldri en ferdig
  validert import om til `validating`.

- `linkedin_import_purposes` — formål med CHECK på
  `profile|career|network|jobs|learning|content`, `selected_at`, `selection_source`,
  unik `(linkedin_import_id, purpose)`.
- `linkedin_import_files` — kun klasse A og B (CHECK `file_class in ('A','B')`),
  arkivsti, `file_hash`, komprimert/ukomprimert størrelse, `status` CHECK
  (`discovered|validated|partially_validated|staged|skipped_no_consent|deferred|invalid`),
  radtellere, `error_code`, `parser_version`, timestamps. **Ingen `purpose`-kolonne.**
  Klasse C får aldri rad her.
- `linkedin_import_file_purposes` — relasjon `(linkedin_import_file_id, purpose)`
  med samme CHECK-liste og `user_id`, slik at én fil kan dekke flere formål.
  Filen stages kun for de formålene brukeren har valgt; øvrige gir
  `skipped_no_consent`.
- Staging per domene: `linkedin_profile_staging`, `linkedin_career_staging`,
  `linkedin_recommendation_staging`, `linkedin_network_staging`,
  `linkedin_job_staging`, `linkedin_learning_staging`, `linkedin_content_staging`.
  Felles kolonnesett: `id`, `user_id`, `first_linkedin_import_id`,
  `last_linkedin_import_id`, `record_kind`, `purpose` (nøyaktig ett, NOT NULL,
  CHECK mot formålslisten), hvitlistede normaliserte felt (ingen rå
  CSV-rad som `jsonb`), `source_system='linkedin_export'`, `source_file`,
  `source_locator_type` (`csv_row|archive_file|html_section`), `source_locator`,
  `source_row_number`, `source_row_hash`, `source_content_hash`, `source_event_at`,
  `source_recorded_at`, `source_url`, `source_classification`, `source_identity_hash`,
  `created_at`, `last_seen_at`.
  **`source_identity_hash` = sha256 over `user_id || source_file || record_kind ||
  normalisert kildeinnhold`** (NFKC-normaliserte, whitespace-trimmede, hvitlistede
  feltverdier i fast rekkefølge). Radnummer inngår ikke, så omorganiserte CSV-rader
  gir ingen dubletter. Unik indeks `(user_id, source_file, source_identity_hash)`:
  identisk innhold oppdaterer kun `last_linkedin_import_id`/`last_seen_at`; endret
  innhold gir ny stagingrad, aldri overskriving.
  **Proveniens-CHECK:** `csv_row` krever `source_row_number` og `source_row_hash` og
  krever `source_content_hash IS NULL`; `html_section` krever `source_content_hash`;
  `archive_file` krever `source_content_hash`.
- `linkedin_import_tombstones` — minimalt revisjonsspor per §6.3.

RLS: eier-policyer (`auth.uid() = user_id`) kun for SELECT på alle tabeller.
`authenticated` har **ingen** INSERT/UPDATE/DELETE-policy — heller ikke DELETE på
`linkedin_imports`; sletting går utelukkende via den kontrollerte serverhandlingen i
§4 slik at tombstone, Storage-sletting og revisjonsregelen ikke kan omgås.
`GRANT SELECT` til `authenticated`, `GRANT ALL` til `service_role`, ingen `anon`.


## 2. Storage

Privat bucket `linkedin-imports`, sti `{user_id}/{import_id}/archive.zip`, ingen
public URL. Parsing skjer helst i minne i samme forespørsel; ZIP lagres kun når
arkivet må gjenbrukes for utsatt staging (utvidede formål). Sletting: umiddelbart ved
`rejected`/`cancelled`, ellers senest 7 dager etter staging. Kun sanitert objektsti
logges.

**Konsekvens som må være synlig i senere UI:** når ZIP-en er slettet etter 7 dager,
kan ikke nye behandlingsformål utvides på den eksisterende importen — brukeren må
laste opp ZIP-en på nytt. Importen får et eksplisitt felt (`archive_available=false`)
slik at fase 3-UI kan vise dette som et tydelig valg, ikke som en stille begrensning.


## 3. Parser- og normaliseringsmodul (server-only)

`src/lib/linkedin/*.server.ts` (filnavn-basert klientblokkering), kalt fra en intern
serverrute etter mønsteret i `src/routes/api/internal/`:

- `preflight.server.ts` — alle porter fra §8.1–8.4 (ZIP-gyldighet, størrelser,
  antall oppføringer, komprimeringsforhold 100:1, path traversal, dublette stier,
  BOM/tegnsett, null-bytes, radtak, felttak, formelinjeksjonsmerking).
- `classify.server.ts` — klasse A/B/C fra kontraktens §2.5-inventar; ukjent fil →
  `unknown_file` på import, blokkerer ikke; manglende valgfri fil →
  `missing_optional_file`.
- `parsers/*.server.ts` — én parser per klasse A-filtype, inkludert
  `connections_csv_preamble_v1`: hopp **nøyaktig tre** preamblelinjer, valider
  forventet header på linje fire, ingen videre søk nedover i filen. Manglende header
  → `connections_header_not_found`; avvikende header → `connections_unexpected_header`.
  Begge er filnivåfeil som ikke stopper resten av importen. Nytt LinkedIn-format
  krever en ny, eksplisitt parserversjon (`connections_csv_preamble_v2`).
- `normalize.server.ts` — NFKC, whitespace, kontrollert ISO-datoparsing med
  eksplisitt presisjon, ingen gjetting; ugyldig verdi → null + maskinlesbar årsak.
- `stage.server.ts` — skriver kun hvitlistede felt, kun for valgte formål; øvrige
  filer får `skipped_no_consent` eller `deferred`.

Ingen rå LinkedIn-tekst i logger; kun filnavn, parserversjon, tellere, feilkoder.

## 4. Retention og sletting

- `public.linkedin_import_delete(p_import_id uuid)` — kalles kun fra serverlaget etter
  verifisert brukeridentitet, kontrollerer eierskap eksplisitt mot innsendt bruker-id,
  `SECURITY DEFINER` med `SET search_path = ''` og fullt kvalifiserte objektnavn,
  `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` (kun `service_role`).
  Rekkefølge: opprett tombstone → slett staging, filrader og fritekst → marker
  Storage-objektet for sletting. Serverhandlingen sletter Storage-objektet etter at
  transaksjonen er committet; feiler Storage-sletting, blir objektet stående i
  slettekø og fjernes av sweepen — databaserader gjenopprettes aldri halvveis.
- `public.linkedin_import_retention_sweep()` — idempotent, samme
  `SECURITY DEFINER`/`search_path`/grant-regler; sletter ZIP ≥7 dager, staging
  ≥90 dager etter `reconciliation_ready`, staging uten brukerhandling per kontraktens
  inaktivitetsgrense, rydder slettekøen for Storage, og setter importer med utløpt
  `heartbeat_at` til `failed` med `staging_timeout`. Rører aldri CV-importer eller
  andre kilder. Testes mot syntetiske data; ikke planlagt i cron i denne fasen.
- Kontraktdokumentet `docs/linkedin-import-contract-v1.md` oppdateres i samme
  leveranse slik at §6.1/§6.2/§9.5 og §1.3 har **én** autoritativ livssyklus:
  ZIP 7 dager, staging 90 dager, samme statusklassifisering som over.


## 5. Tester

Vitest med syntetiske minimale ZIP-er (aldri Henriks arkiv i databasen), pluss et
SQL-canary-skript `scripts/canary/linkedin-import-phase2-tests.sql` for RLS og
produktdata-uendrethet. Dekker alle 14 portene i oppdraget, inkludert idempotens
(samme ZIP, ompakket ZIP, utvidet formål), filnivåfeil, klasse B/C-oppførsel,
RLS-isolasjon mellom to brukere, retention, og en bunt-sjekk på at ingen
serverparser/ZIP-bibliotek/service-role-nøkkel havner i klientbunten.

## 6. Rapport

Migrasjoner og objekter, RLS-resultat, preflight/parserresultat, idempotens,
testresultat per port, bekreftelse på null produktdataskriving, valgt Storage- og
retentionløsning, avvik. Stopp før fase 3.
