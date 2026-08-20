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
  Unik indeks `(user_id, archive_sha256)`. Terminale statuser: `rejected`, `cancelled`,
  `staged`/`reconciliation_ready` (ferdig); gjenprøvbare: `uploaded`, `validating`,
  `partially_validated`, `failed`.
- `linkedin_import_purposes` — formål med CHECK på
  `profile|career|network|jobs|learning|content`, `selected_at`, `selection_source`,
  unik `(linkedin_import_id, purpose)`.
- `linkedin_import_files` — kun klasse A og B (CHECK `file_class in ('A','B')`),
  arkivsti, `file_hash`, komprimert/ukomprimert størrelse, `status` CHECK
  (`discovered|validated|partially_validated|staged|skipped_no_consent|deferred|invalid`),
  `purpose`, radtellere, `error_code`, `parser_version`, timestamps.
  Klasse C får aldri rad her.
- Staging per domene: `linkedin_profile_staging`, `linkedin_career_staging`,
  `linkedin_recommendation_staging`, `linkedin_network_staging`,
  `linkedin_job_staging`, `linkedin_learning_staging`, `linkedin_content_staging`.
  Felles kolonnesett: `id`, `user_id`, `first_linkedin_import_id`,
  `last_linkedin_import_id`, `record_kind`, hvitlistede normaliserte felt (ingen rå
  CSV-rad som `jsonb`), `source_system='linkedin_export'`, `source_file`,
  `source_locator_type` (`csv_row|archive_file|html_section`), `source_locator`,
  `source_row_number`, `source_row_hash`, `source_content_hash`, `source_event_at`,
  `source_recorded_at`, `source_url`, `source_classification`, `created_at`,
  `last_seen_at`. Unik indeks `(user_id, source_file, source_identity_hash)` gir
  idempotens: gjentatt kjøring oppdaterer kun `last_linkedin_import_id`/`last_seen_at`;
  endret innhold gir ny rad.
- `linkedin_import_tombstones` — minimalt revisjonsspor per §6.3.

RLS: eier-policyer (`auth.uid() = user_id`) for SELECT på alle tabeller; ingen
INSERT/UPDATE/DELETE for `authenticated` på stagingtabellene (kun `service_role`),
DELETE tillatt for eier på `linkedin_imports` slik at sletting kaskaderer.
`GRANT SELECT` til `authenticated`, `GRANT ALL` til `service_role`, ingen `anon`.

## 2. Storage

Privat bucket `linkedin-imports`, sti `{user_id}/{import_id}/archive.zip`, ingen
public URL. Parsing skjer helst i minne i samme forespørsel; ZIP lagres kun når
arkivet må gjenbrukes for utsatt staging (utvidede formål). Sletting: umiddelbart ved
`rejected`/`cancelled`, ellers senest 7 dager etter staging. Kun sanitert objektsti
logges.

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
  `connections_csv_preamble_v1` (hopp preamble ≤10 linjer, valider reell header,
  `connections_header_not_found` / `connections_unexpected_header` på filnivå).
- `normalize.server.ts` — NFKC, whitespace, kontrollert ISO-datoparsing med
  eksplisitt presisjon, ingen gjetting; ugyldig verdi → null + maskinlesbar årsak.
- `stage.server.ts` — skriver kun hvitlistede felt, kun for valgte formål; øvrige
  filer får `skipped_no_consent` eller `deferred`.

Ingen rå LinkedIn-tekst i logger; kun filnavn, parserversjon, tellere, feilkoder.

## 4. Retention og sletting

- `linkedin_import_delete(import_id)` — SECURITY DEFINER RPC, eiersjekk, sletter ZIP-
  referanse, filrader, staging og fritekst; oppretter tombstone.
- `linkedin_import_retention_sweep()` — idempotent, sletter ZIP ≥7 dager, staging
  ≥90 dager etter `reconciliation_ready`, og staging uten brukerhandling per
  kontraktens inaktivitetsgrense. Rører aldri CV-importer eller andre kilder.
  Testes mot syntetiske data; ikke planlagt i cron i denne fasen.

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
