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
  `archive_available boolean not null` — **ingen default**. Settes `true` først etter
  vellykket skriv til privat Storage-bucket; parsing i minne uten lagret ZIP settes
  eksplisitt `false`; retention-sweep setter `false` i samme kontrollflyt som sletter
  objektet. Fase 3-UI leser feltet for å vise at nye formål krever ny opplasting.
  `canonical_import_id` er en **self-FK** til `public.linkedin_imports(id)`, sammensatt
  som `(canonical_import_id, user_id)` → `(id, user_id)` slik at kanonisk import alltid
  tilhører samme bruker. Hjelpe-unik `(id, user_id)` på tabellen.
  **Unikhet ved reimport:** partiell unik indeks `(user_id, archive_sha256)`
  `WHERE purged_at IS NULL AND status <> 'cancelled'` — en slettet/purget import
  blokkerer ikke ny opplasting av identisk ZIP, og tombstone beholdes urørt.
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
  `profile|career|network|jobs|learning|content`, `user_id`, `selected_at`,
  `selection_source`, unik `(linkedin_import_id, purpose)`, sammensatt FK
  `(linkedin_import_id, user_id)` → `linkedin_imports(id, user_id)`.
- `linkedin_import_files` — kun klasse A og B (CHECK `file_class in ('A','B')`),
  `user_id`, arkivsti, `file_hash`, komprimert/ukomprimert størrelse, `status` CHECK
  med **kun teknisk filstatus**: `discovered|validated|partially_validated|invalid`,
  radtellere, `error_code`, `parser_version`, timestamps. **Ingen `purpose`-kolonne**
  og ingen samtykke-/formålsutfall i denne statusen. Klasse C får aldri rad her.
  Sammensatt FK `(linkedin_import_id, user_id)` → `linkedin_imports(id, user_id)`;
  hjelpe-unik `(id, user_id)`.
- `linkedin_import_file_purposes` — `(linkedin_import_file_id, purpose)` unik, med
  `user_id`, `status` CHECK (`pending|staged|skipped_no_consent|deferred|failed`),
  `staged_record_count`, `error_code`, `created_at`, `updated_at`. Formålsutfall bor
  her: samme fil kan være `staged` for ett formål, `skipped_no_consent` for et annet
  og `deferred` når innholdet er klasse B. Sammensatt FK
  `(linkedin_import_file_id, user_id)` → `linkedin_import_files(id, user_id)`.
- `linkedin_staging_records` — **felles foreldretabell** for all staging:
  `id`, `user_id`, `staging_domain` (CHECK mot de sju domenene), `record_kind`,
  `purpose` (nøyaktig ett, NOT NULL, CHECK mot formålslisten), all felles proveniens
  (`source_system='linkedin_export'`, `source_file`, `source_locator_type`
  (`csv_row|archive_file|html_section`), `source_locator`, `source_row_number`,
  `source_row_hash`, `source_content_hash`, `source_event_at`, `source_recorded_at`,
  `source_url`, `source_classification`), `source_identity_hash`,
  `first_linkedin_import_id`, `last_linkedin_import_id`, `created_at`, `last_seen_at`,
  `preserved_tombstone_id uuid NULL REFERENCES public.linkedin_import_tombstones(id)`
  — settes **kun** når en stagingrad må bevares uten gjenværende aktiv import.
  Begge import-referansene er sammensatte FK-er med `user_id`.

  Unik indeks `(user_id, source_file, source_identity_hash)` og hjelpe-unike
  `(id, user_id)`, `(id, staging_domain)`, `(id, purpose)` som domenetabellene og
  koblingstabellen refererer til.
- Domenetabeller: `linkedin_profile_staging`, `linkedin_career_staging`,
  `linkedin_recommendation_staging`, `linkedin_network_staging`,
  `linkedin_job_staging`, `linkedin_learning_staging`, `linkedin_content_staging`.
  Hver har `staging_record_id uuid PRIMARY KEY REFERENCES
  public.linkedin_staging_records(id) ON DELETE CASCADE` (1:1), `user_id` og kun
  domenespesifikke, hvitlistede normaliserte felt — ingen rå CSV-rad som `jsonb`,
  ingen duplisert proveniens. Domenetilhørighet håndheves med sammensatt FK
  `(staging_record_id, staging_domain)` mot foreldreraden, der domenekolonnen er en
  generert konstant per tabell; tenant-samsvar håndheves med
  `(staging_record_id, user_id)` → `linkedin_staging_records(id, user_id)`.
  **`source_identity_hash`** = SHA-256 av en **kanonisk serialisert, versjonert
  struktur** (`{"v":"linkedin_identity_v1","user_id":…,"purpose":…,"source_file":…,
  "record_kind":…,"fields":{navngitte hvitlistede felt i sortert rekkefølge}}`) med
  entydige skilletegn — aldri ren strengkonkatenering. `purpose` inngår i strukturen,
  så samme kildeinnhold behandlet for to ulike formål gir to distinkte stagingrader
  uten kollisjon. Feltverdier er NFKC-normaliserte og whitespace-trimmede. Radnummer
  inngår ikke, så omorganiserte CSV-rader gir ingen dubletter: identisk innhold
  oppdaterer kun `last_linkedin_import_id`/`last_seen_at`; endret innhold gir ny
  stagingrad, aldri overskriving.
  **Proveniens-CHECK** (på foreldretabellen): `csv_row` krever `source_row_number` +
  `source_row_hash` og forbyr `source_content_hash`; `html_section` og `archive_file`
  krever `source_content_hash` og forbyr `source_row_number`/`source_row_hash`.
- `linkedin_import_stage_records` — kobling import ↔ stagingrad, med ekte FK-er:
  `linkedin_import_id`, `attempt_id`, `user_id`, `staging_record_id` →
  `public.linkedin_staging_records(id)`, `staging_domain`, `purpose`,
  `source_identity_hash`, `linked_at`. Unik
  `(linkedin_import_id, attempt_id, staging_record_id)`.
  Integritet håndheves i databasen, ikke bare i serverkoden: sammensatte FK-er
  `(linkedin_import_id, user_id)` → `linkedin_imports(id, user_id)`,
  `(staging_record_id, user_id)` → `linkedin_staging_records(id, user_id)`,
  `(staging_record_id, staging_domain)` og `(staging_record_id, purpose)` mot
  foreldreradens tilsvarende hjelpe-unike nøkler. Ingen polymorf tekstreferanse.
  Ved retry fjernes **kun** koblinger med det feilede `attempt_id`; en stagingrad
  slettes bare når den ikke har koblinger fra noen annen import eller noe annet
  forsøk. Det beskytter allerede staget grunnlag når samme import senere utvides med
  et nytt behandlingsformål.
- `linkedin_import_tombstones` — minimalt revisjonsspor per §6.3. Tombstone har ingen
  FK til importraden og blokkerer aldri en senere identisk reimport.



RLS: eier-policyer (`auth.uid() = user_id`) kun for SELECT på alle tabeller.
`authenticated` har **ingen** INSERT/UPDATE/DELETE-policy — heller ikke DELETE på
`linkedin_imports`; sletting går utelukkende via den kontrollerte serverhandlingen i
§4 slik at tombstone, Storage-sletting og revisjonsregelen ikke kan omgås.
Tenant-samsvar hviler på sammensatte FK-er over, ikke på at service-role alltid
sender riktig `user_id`.

`GRANT SELECT` til `authenticated`, `GRANT ALL` til `service_role`, ingen `anon`.


## 2. Storage

Privat bucket `linkedin-imports`, sti `{user_id}/{import_id}/archive.zip`, ingen
public URL. Parsing skjer helst i minne i samme forespørsel; ZIP lagres kun når
arkivet må gjenbrukes for utsatt staging (utvidede formål). Sletting: umiddelbart ved
`rejected`/`cancelled`, ellers senest 7 dager etter staging. Kun sanitert objektsti
logges.

`archive_available` speiler faktisk tilstand og settes eksplisitt i hver kontrollflyt:
`true` først etter bekreftet skriv til bucketen, `false` ved rein minneparsing, og
`false` i samme flyt som sletter objektet (manuell sletting eller retention-sweep).

**Konsekvens som må være synlig i senere UI:** når ZIP-en er slettet etter 7 dager,
kan ikke nye behandlingsformål utvides på den eksisterende importen — brukeren må
laste opp ZIP-en på nytt, og partiell unikhet gjør at identisk ZIP kan lastes opp
igjen etter purge.



## 3. Parser- og normaliseringsmodul (server-only)

`src/lib/linkedin/*.server.ts` (filnavn-basert klientblokkering), kalt fra en intern
serverrute etter mønsteret i `src/routes/api/internal/`. Ruten autentiserer den
interne worker-/arbeidsgiverhemmeligheten (eksisterende godkjent worker-mønster,
timing-safe sammenligning) **før** enhver databasekontakt; uten korrekt intern
autorisasjon returneres 401 uten å røre databasen. Dette kommer i tillegg til
brukerautentiseringen som gjelder for senere brukerutløste handlinger.


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
- `stage.server.ts` — skriver foreldrerad i `linkedin_staging_records` + domenerad +
  koblingsrad (`linkedin_import_stage_records` med gjeldende `attempt_id`) i samme
  transaksjon; kun hvitlistede felt og kun for valgte formål. Utfall per fil og formål
  skrives til `linkedin_import_file_purposes` (`staged`, `skipped_no_consent`,
  `deferred`, `failed`) med `staged_record_count`.


Ingen rå LinkedIn-tekst i logger; kun filnavn, parserversjon, tellere, feilkoder.

## 4. Retention og sletting

- Sletteflyt: (1) serverruten verifiserer JWT, (2) henter `user_id` **utelukkende**
  fra den verifiserte sesjonen, (3) leser importen og bekrefter
  `linkedin_imports.user_id = session.user.id`, (4) kaller først da databasefunksjonen
  med import-id. Klientens body eller parametre inneholder aldri autoritativ `user_id`.
- `public.linkedin_import_delete(p_import_id uuid)` — `SECURITY DEFINER` med
  `SET search_path = ''` og fullt kvalifiserte objektnavn,
  `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` (kun `service_role`).
  Alt under skjer i **én transaksjon**, i denne rekkefølgen:
  1. opprett tombstone for importen
  2. finn alle stagingrader som refererer til importen via
     `first_linkedin_import_id`/`last_linkedin_import_id`
  3. slett importens koblinger i `linkedin_import_stage_records`
  4. slett stagingrader som ikke lenger har noen kobling fra noen import/forsøk
  5. for **beholdte** stagingrader: reparer referansene før commit — sett
     `first_linkedin_import_id` til eldste og `last_linkedin_import_id` til nyeste
     gjenværende import utledet fra `linkedin_import_stage_records`; finnes ingen
     gyldig import, men raden skal bevares, knyttes den til importens tombstone via
     `preserved_tombstone_id` (eksplisitt, dokumentert bevaringsregel)
  6. slett filrader, formålsrader og fritekst
  7. marker Storage-objektet for sletting og sett `archive_available = false`

  FK-ene på `first/last_linkedin_import_id` bruker aldri `ON DELETE SET NULL`: enten
  peker de på en gyldig gjenværende import, eller raden er tombstone-forankret via
  `preserved_tombstone_id`, eller den er slettet. Serverhandlingen sletter
  Storage-objektet etter commit; feiler Storage-sletting, blir objektet stående i
  slettekø og fjernes av sweepen — databaserader gjenopprettes aldri halvveis. Samme
  referansereparasjon gjelder når retention-sweepen purger en import.
- **Endelig tilstand (valgt modell: B, tombstone-markert rad).** Siste steg i samme
  transaksjon, etter referansereparasjon, fil-/formålsopprydding og Storage-slettekø:
  importraden beholdes med `purged_at = now()`, `status = 'cancelled'`,
  `archive_available = false`, `active_phase = null`, nullstilte tellefelt og ingen
  aktive fil-, formåls-, staging- eller Storage-koblinger. Raden er da rent historisk.
  Tombstone ligger separat i `linkedin_import_tombstones`.
  Den partielle unikindeksen `(user_id, archive_sha256)
  WHERE purged_at IS NULL AND status <> 'cancelled'` treffer derfor ikke slike rader:
  en slettet import kan aldri blokkere ny import av samme ZIP.



- **Kanonisk import ved sletting:** dersom andre importrader peker til importen som
  slettes, må flyten enten (a) velge og validere en ny kanonisk import blant de
  gjenværende importene for samme bruker og flytte alle `canonical_import_id`-
  referanser atomisk i samme transaksjon, eller (b) avvise slettingen med
  `canonical_import_in_use`. Self-FK-en garanterer at ingen import blir stående med
  en ugyldig kanonisk referanse.
- `public.linkedin_import_retention_sweep()` — idempotent, samme
  `SECURITY DEFINER`/`search_path`/grant-regler; sletter ZIP ≥7 dager (og setter
  `archive_available = false`), staging ≥90 dager etter `reconciliation_ready`,
  staging uten brukerhandling per kontraktens inaktivitetsgrense, rydder slettekøen
  for Storage, og setter importer med utløpt `heartbeat_at` til `failed` med
  `staging_timeout`. Rører aldri CV-importer eller andre kilder. Testes mot
  syntetiske data; ikke planlagt i cron i denne fasen.
- **Reopplasting etter retention ≠ reimport etter sletting.** To distinkte flyter,
  avgjort av om det finnes en aktiv import med samme `(user_id, archive_sha256)`:
  - *Aktiv import finnes, men `archive_available = false`* (ZIP slettet etter 7 dager):
    dette er **ikke** en ny import. Flyten gjenbruker den eksisterende importraden,
    oppretter nytt `attempt_id`, lagrer nytt privat ZIP-objekt, setter
    `archive_available = true` **først** etter bekreftet Storage-skriv, beholder alle
    eksisterende stagingkoblinger, og stager kun de nye, senere valgte formålene.
  - *Ingen aktiv import (manuelt slettet eller purget)*: opplasting av samme ZIP
    oppretter en ny, ren importrad. Tombstone beholdes som revisjonsspor og blokkerer
    ikke, siden den partielle unikheten kun gjelder aktive rader. Ingen arvede
    stagingkoblinger.

- Kontraktdokumentet `docs/linkedin-import-contract-v1.md` oppdateres i samme
  leveranse slik at §6.1/§6.2/§9.5 og §1.3 har **én** autoritativ livssyklus:
  ZIP 7 dager, staging 90 dager, samme statusklassifisering som over — og slik at
  datamodellavsnittet beskriver felles `linkedin_staging_records` med 1:1
  domenetabeller, tenant-samsvar via sammensatte FK-er, formål i identitetshashen,
  formålsstatus per fil, `attempt_id`-isolasjon, self-FK for kanonisk import,
  reimportregelen og `archive_available` uten default.



## 5. Tester

Vitest med syntetiske minimale ZIP-er (aldri Henriks arkiv i databasen), pluss et
SQL-canary-skript `scripts/canary/linkedin-import-phase2-tests.sql` for RLS og
produktdata-uendrethet. Dekker alle 14 portene i oppdraget, inkludert idempotens
(samme ZIP, ompakket ZIP, utvidet formål), filnivåfeil, klasse B/C-oppførsel,
RLS-isolasjon mellom to brukere, retention, og en bunt-sjekk på at ingen
serverparser/ZIP-bibliotek/service-role-nøkkel havner i klientbunten.

Nye tester:

1. FK-test: kobling i `linkedin_import_stage_records` mot ukjent `staging_record_id`
   avvises, og feil `staging_domain` mot eksisterende forelder avvises.
2. Formålsstatus: samme fil støtter to formål, brukeren velger kun det ene. Valgt
   formål får `staged`, ikke-valgt formål får `skipped_no_consent`, og
   `linkedin_import_files.status` forblir rent teknisk.

3. Retry etter utvidet formål: nytt `attempt_id` rydder kun sitt eget forsøk;
   tidligere vellykket stagingkobling og delt stagingrad består.
4. Kall mot internruten uten korrekt intern autorisasjon avvises (401) uten
   databasekontakt.
5. Tenant-samsvar: forsøk på å knytte fil, formål, domenestaging, koblingsrad eller
   `canonical_import_id` på tvers av to brukere avvises av sammensatt FK.
6. Kanonisk import: sletting av en import som andre peker til flytter referansene
   atomisk, eller avvises med `canonical_import_in_use` — aldri ugyldig referanse.
7. Reimport etter sletting: slett/purge import (rad står igjen med `purged_at` og
   `status = cancelled`) → last opp identisk syntetisk ZIP → ny aktiv importrad
   opprettes uten at den partielle unikindeksen blokkerer, tombstone består, ingen
   arvede stagingkoblinger.
7b. Reopplasting etter retention: aktiv import med `archive_available = false` →
   identisk ZIP lastes opp → **ingen** ny importrad; samme import får nytt
   `attempt_id`, nytt Storage-objekt, `archive_available = true` etter skriv,
   eksisterende stagingkoblinger intakte, og kun nye valgte formål stages.

8. `archive_available`: `true` kun etter bekreftet Storage-skriv; `false` ved
   minneparsing og etter retention-sweep.
9. Formål i identitetshashen: samme kildeinnhold behandlet for to formål gir to
   distinkte stagingrader uten unikhetskollisjon.
10. Delt stagingrad ved sletting: to importer deler samme stagingrad, første import
    slettes. Stagingraden beholdes, `first/last_linkedin_import_id` peker kun til den
    gyldige gjenværende importen, alle FK-er validerer, og den andre importen kan
    fortsatt leses og senere slettes kontrollert.
11. Tombstoneforankring: når siste aktive import for en bevart stagingrad slettes,
    settes `preserved_tombstone_id` til importens tombstone, FK-en validerer, og
    `first/last_linkedin_import_id` blir aldri hengende på en slettet import.





## 6. Rapport

Migrasjoner og objekter, RLS-resultat, preflight/parserresultat, idempotens,
testresultat per port, bekreftelse på null produktdataskriving, valgt Storage- og
retentionløsning, avvik. Stopp før fase 3.
