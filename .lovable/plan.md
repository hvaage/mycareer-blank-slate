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
  `archive_available boolean not null default true` — settes eksplisitt til `false`
  når ZIP-en er slettet, slik at fase 3-UI kan vise at nye formål krever ny opplasting.
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
  arkivsti, `file_hash`, komprimert/ukomprimert størrelse, `status` CHECK med **kun
  teknisk filstatus**: `discovered|validated|partially_validated|invalid`,
  radtellere, `error_code`, `parser_version`, timestamps. **Ingen `purpose`-kolonne**
  og ingen samtykke-/formålsutfall i denne statusen. Klasse C får aldri rad her.
- `linkedin_import_file_purposes` — `(linkedin_import_file_id, purpose)` unik, med
  `user_id`, `status` CHECK (`pending|staged|skipped_no_consent|deferred|failed`),
  `staged_record_count`, `error_code`, `created_at`, `updated_at`. Formålsutfall bor
  her: samme fil kan være `staged` for ett formål, `skipped_no_consent` for et annet
  og `deferred` når innholdet er klasse B.
- `linkedin_staging_records` — **felles foreldretabell** for all staging:
  `id`, `user_id`, `staging_domain` (CHECK mot de sju domenene), `record_kind`,
  `purpose` (nøyaktig ett, NOT NULL, CHECK mot formålslisten), all felles proveniens
  (`source_system='linkedin_export'`, `source_file`, `source_locator_type`
  (`csv_row|archive_file|html_section`), `source_locator`, `source_row_number`,
  `source_row_hash`, `source_content_hash`, `source_event_at`, `source_recorded_at`,
  `source_url`, `source_classification`), `source_identity_hash`,
  `first_linkedin_import_id`, `last_linkedin_import_id`, `created_at`, `last_seen_at`.
  Unik indeks `(user_id, source_file, source_identity_hash)` og en hjelpe-unik
  `(id, staging_domain)` som domenetabellene og koblingstabellen kan referere til.
- Domenetabeller: `linkedin_profile_staging`, `linkedin_career_staging`,
  `linkedin_recommendation_staging`, `linkedin_network_staging`,
  `linkedin_job_staging`, `linkedin_learning_staging`, `linkedin_content_staging`.
  Hver har `staging_record_id uuid PRIMARY KEY REFERENCES
  public.linkedin_staging_records(id) ON DELETE CASCADE` (1:1), `user_id` og kun
  domenespesifikke, hvitlistede normaliserte felt — ingen rå CSV-rad som `jsonb`,
  ingen duplisert proveniens. Domenetilhørighet håndheves med FK mot
  `(staging_record_id, staging_domain)` og en genererte/CHECK-låst domenekolonne, slik
  at f.eks. en karriererad ikke kan henge på en `network`-forelder.
  **`source_identity_hash`** = SHA-256 av en **kanonisk serialisert, versjonert
  struktur** (`{"v":"linkedin_identity_v1","user_id":…,"source_file":…,
  "record_kind":…,"fields":{navngitte hvitlistede felt i sortert rekkefølge}}`) med
  entydige skilletegn — aldri ren strengkonkatenering. Feltverdier er NFKC-normaliserte
  og whitespace-trimmede. Radnummer inngår ikke, så omorganiserte CSV-rader gir ingen
  dubletter: identisk innhold oppdaterer kun `last_linkedin_import_id`/`last_seen_at`;
  endret innhold gir ny stagingrad, aldri overskriving.
  **Proveniens-CHECK** (på foreldretabellen): `csv_row` krever `source_row_number` +
  `source_row_hash` og forbyr `source_content_hash`; `html_section` og `archive_file`
  krever `source_content_hash` og forbyr `source_row_number`/`source_row_hash`.
- `linkedin_import_stage_records` — kobling import ↔ stagingrad, med ekte FK:
  `linkedin_import_id`, `attempt_id`, `user_id`, `staging_record_id` →
  `public.linkedin_staging_records(id)`, `staging_domain` (validert mot foreldreraden
  via sammensatt FK `(staging_record_id, staging_domain)`, ikke polymorf tekst),
  `purpose`, `source_identity_hash`, `linked_at`. Unik
  `(linkedin_import_id, attempt_id, staging_record_id)`.
  Ved retry fjernes **kun** koblinger med det feilede `attempt_id`; en stagingrad
  slettes bare når den ikke har koblinger fra noen annen import eller noe annet
  forsøk. Det beskytter allerede staget grunnlag når samme import senere utvides med
  et nytt behandlingsformål.
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

- Sletteflyt: (1) serverruten verifiserer JWT, (2) henter `user_id` **utelukkende**
  fra den verifiserte sesjonen, (3) leser importen og bekrefter
  `linkedin_imports.user_id = session.user.id`, (4) kaller først da databasefunksjonen
  med import-id. Klientens body eller parametre inneholder aldri autoritativ `user_id`.
- `public.linkedin_import_delete(p_import_id uuid)` — `SECURITY DEFINER` med
  `SET search_path = ''` og fullt kvalifiserte objektnavn,
  `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` (kun `service_role`).
  Rekkefølge: opprett tombstone → slett denne importens koblinger i
  `linkedin_import_stage_records` → slett stagingrader som ikke lenger har noen
  importreferanse (delte rader beholdes) → slett filrader og fritekst → marker
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
