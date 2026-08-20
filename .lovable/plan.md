# Fase 1 — LinkedIn-eksport: importkontrakt og preflight (kun dokument)

Leveransen i denne fasen er ett dokument: `docs/linkedin-import-contract-v1.md`.
Ingen migrasjon, ingen deploy, ingen import av den vedlagte ZIP-en, ingen endring av produktdata.

## Grunnlag som allerede er verifisert

Filinventar er lest read-only fra den vedlagte ZIP-en (53 oppføringer, inkl. `messages.csv` 2,5 MB, `Connections.csv`, `Positions.csv`, `Jobs/*`, `Articles/**`, `Verifications/**`, `Ad_Targeting.csv`, `Inferences_about_you.csv`). Inventaret inneholder også `Ads Clicked.csv`, som ikke er nevnt i instruksen — foreslås klasse C (`inferred_sensitive_data`/annonseprofil).

Eksisterende modell som kontrakten skal bygge videre på (bekreftet mot databasen):
- `cv_imports` (import_type, source_filename, status, raw_parsed_data, tellere) — har ingen hash-kolonne i dag.
- `cv_parse_candidates` (local_ref/parent_local_ref, structured_data, dedupe_key, source_type/source_ref, parse_confidence, status, promoted_atom_id) — kanonisk kandidatlag før `career_atoms`.
- `career_atoms` (atom_class og attestation settes av databasen), `career_atom_links`, `cv_review_progress`, `atom_enrichment_proposals`.
- Produktområder som ikke skal skrives til: `profiles`, `user_career_profiles`, `contacts`, `job_leads`, `user_opportunities`, `job_applications`, `documents`.

## Dokumentets innhold

1. **Importformat og identitet** — `linkedin_export_v1`, kontraktversjon `linkedin_export_contract_v1`, SHA-256 per ZIP, idempotens på (bruker, zip-hash), `unknown_file` og `missing_optional_file` som rapporterte utfall, statusmaskin: `uploaded → validating → validated|rejected → staged → reconciliation_ready`, pluss `failed`/`cancelled`, med terminale vs. gjenprøvbare statuser.
2. **Filinventar** — komplett tabell med én rad per fil fra den vedlagte ZIP-en: klasse A/B/C, målområde, staging ja/nei, krav om brukerbekreftelse, evidensnivå og personvernbegrunnelse. Klasse C får maskinlesbare eksklusjonsårsaker.
3. **Datakontrakt per produktområde** — additive DTO-er for Min profil/Om meg, Karriereoversikt og kvalifikasjoner, anbefalinger/endorsements, jobber og muligheter. Feltnivåvalg `use_linkedin | keep_existing | merge | dismiss`. Eksplisitt liste over felt som aldri importeres automatisk.
4. **Proveniens- og evidensregler** — `source_system=linkedin_export`, `source_file`, `source_row_number`, `source_row_hash`, `linkedin_import_id`, `imported_at`, `source_observed_at`, `source_url`, og kildeklassifisering (`self_reported`, `third_party_recommendation`, `third_party_endorsement`, `user_activity`, `user_preference`, `historical_record`). Ingen LinkedIn-kilde gir `documented` eller `user_attested`.
5. **Dedupliseringskontrakt** — matchrekkefølge og utfall (`match`, `possible_duplicate`, `conflict`) for kontakt, rolle, sertifisering, jobb og anbefaling. Ingen regel sletter eller overskriver.
6. **Preflight og sikkerhetsporter** — ZIP-validitet, størrelses- og radtak, tegnsett, header-validering, path traversal, formelinjeksjon ved visning/eksport, hash per fil, tellere per fil, RLS-krav (kun eier), og forbud mot klartekst fra anbefalinger/artikler/private felt i logger.
7. **Verifikasjon og rapport** — gjenbrukbare tabeller/RPC-er, hvilke felt som må være additive senere (bl.a. hash og kildesystem på importnivå), avvik mellom kontrakt og faktisk modell, komplett A/B/C-inventar, anbefalt fase 2-datamodell på tabellnivå (kun beskrevet), og bekreftelse på at ingenting er deployet eller endret.

## Avvik som dokumenteres eksplisitt

- `cv_imports` mangler i dag `source_hash`, `contract_version` og per-fil-tellere; foreslås som additive felt eller egne LinkedIn-tabeller i fase 2.
- `contacts` er i dag knyttet til `application_id` og har ingen proveniensfelt; LinkedIn-kontakter må derfor gå via et eget staging-lag, ikke direkte inn.
- `Ads Clicked.csv` finnes i eksporten, men mangler i instruksens klasseliste — foreslås klasse C.

## Teknisk

Kun én ny fil opprettes: `docs/linkedin-import-contract-v1.md`. Ingen kode, migrasjoner, RPC-er, edge functions eller frontend-endringer.
