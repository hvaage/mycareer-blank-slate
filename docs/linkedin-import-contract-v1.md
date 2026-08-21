# LinkedIn-import: kanonisk importkontrakt v1

**Kontraktversjon:** `linkedin_export_contract_v1`
**Importobjekt:** `linkedin_export_v1`
**Status:** Fase 1 — kontrolldokument. Ingen migrasjon, ingen tabeller, ingen RPC-er,
ingen Edge Functions, ingen UI, ingen dataskriving. Dokumentet er kanonisk for fase 2–5.

Referansegrunnlaget er én representativ Basic LinkedIn Data Export, lest read-only.
Ingen del av eksporten er lagret, importert eller koblet til produktdata.

---

## 0. Arkitekturvalg: eget LinkedIn-importlag

LinkedIn-import bygges **ikke** på `cv_imports`/`cv_parse_candidates`.

Begrunnelse:

| Forhold | `cv_imports` (dagens) | LinkedIn Basic Data Export |
| --- | --- | --- |
| Kildeenhet | ett dokument, én fil | ett arkiv med ~50 heterogene filer |
| Parsing | AI-parsing av fritekst til én struktur | deterministisk CSV/HTML-lesing per filtype |
| Domener | kun CV-innhold | profil, karriere, nettverk, jobber, læring, innhold |
| Proveniens | `source_ref` = import-id | fil + lokator + radhash + innholdshash per verdi |
| Samtykke | implisitt i CV-opplasting | må velges per behandlingsformål |
| Sletting | sletter CV-import og kandidater | må slette rå arkiv, per-fil-staging og fritekst, med differensiert revisjonsspor |
| Delvis feil | én fil = alt eller ingenting | én ugyldig CSV skal ikke avvise hele arkivet |

Å presse dette inn i `cv_imports` ville krevd at CV-spesifikke felter (`source_filename`,
`raw_parsed_data`, `atoms_created_count`) fikk ny betydning per filtype, og at
statusmaskinen for CV-gjennomgang også måtte dekke nettverk, jobber og læring.
Utvidelse av `cv_imports` er derfor ikke et alternativ i denne kontrakten.

Fase 2 skal anbefale minimum:

- `linkedin_imports` — én rad per arkiv per bruker
- `linkedin_import_files` — én rad per arkivoppføring, med filnivåstatus
- separate staging-/normaliseringsobjekter per domene

Kandidater fra LinkedIn møter den eksisterende gjennomgangsmodellen først når de
promoteres til forslag; de skriver aldri direkte til `career_atoms`.

---

## 1. Importformat og identitet

### 1.1 Identiteter

| Identitet | Beregning | Formål |
| --- | --- | --- |
| `archive_sha256` | SHA-256 av mottatt ZIP-fil, byte for byte | teknisk idempotens ved identisk fil |
| `content_manifest_hash` | SHA-256 av sortert manifest: `\n`-separert liste av `sha256(filinnhold) + "\t" + normalisert filsti`, sortert på filsti | oppdager samme innhold pakket på nytt |

Begge er unike **per bruker** (`user_id`), aldri globalt. To brukere med samme
arkivinnhold er to uavhengige importer.

### 1.2 Utfallsmatrise

| Situasjon | Utfall |
| --- | --- |
| Identisk ZIP (`archive_sha256` finnes for brukeren) | eksisterende import returneres. Ingen ny parsing, ingen nye stagingrader, ingen nye forslag. |
| Ny ZIP, identisk innhold (`content_manifest_hash` finnes, ny `archive_sha256`) | ny importrad opprettes med `duplicate_of_import_id` satt og `reparse = false`. Ingen nye stagingrader; brukeren peker til eksisterende gjennomgang. |
| Ny ZIP, delvis overlappende innhold | ny import. Kun filer med ny `file_sha256` stages. Uendrede filer markeres `unchanged` og gjenbruker forrige normalisering. Domenedata avstemmes mot forrige import og mot produktdata. |
| Ukjent fil i arkivet | `unknown_file`. Rapporteres i filinventaret, stages ikke, innhold leses ikke. Aldri stille ignorert. |
| Manglende forventet fil | `missing_optional_file`. Ingen feil; importen fortsetter. |
| Ugyldig enkeltfil i ellers gyldig ZIP | fil får `rejected` med maskinlesbar årsak. Importen fortsetter og ender i `partially_validated`. |

### 1.3 Statusmaskin

**Importnivå:**

```text
uploaded → validating → validated ─────────────► staged → reconciliation_ready
                     ├→ partially_validated ───┘
                     └→ rejected
   (når som helst) → failed | cancelled
```

| Status | Betydning | Terminal | Kan prøves på nytt |
| --- | --- | --- | --- |
| `uploaded` | arkiv mottatt, ikke lest | nei | – |
| `validating` | preflight pågår | nei | – |
| `validated` | alle kjente filer validerte | nei | – |
| `partially_validated` | minst én fil `rejected`, minst én `validated` | nei | ja, per fil |
| `rejected` | arkivet er ubrukelig (ugyldig ZIP, grensebrudd, ingen kjente filer) | ja | ny opplasting |
| `staged` | validerte filer normalisert til staging | nei | – |
| `reconciliation_ready` | avstemming mot produktdata klar for bruker | ja (for importfasen) | – |
| `failed` | systemfeil under behandling | ja | ja, samme arkiv |
| `cancelled` | avbrutt av bruker | ja | nei |

**Filnivå (`linkedin_import_files.status`):**
`pending`, `validated`, `rejected`, `skipped_excluded`, `skipped_deferred`,
`unknown`, `unchanged`.

Filnivåstatus er autoritativ for hva som kan stages. Importstatusen er avledet.

---

## 2. Filinventar og behandlingsklasse

### 2.1 Tellinger i referansearkivet

Tellingene er definert slik at de ikke blandes sammen:

| Måltall | Definisjon | Verdi |
| --- | --- | --- |
| Arkivoppføringer | alle oppføringer i ZIP-katalogen | 52 |
| Mappeoppføringer | oppføringer med `is_dir() = true` | 0 (mapper er implisitte i stien) |
| Faktiske datafiler | oppføringer som ikke er mapper | 52 |
| Kjente filer | datafiler som matcher kontraktens filkatalog | 52 |
| Ukjente filer | datafiler uten match | 0 |
| Klasse A-filer | godkjent kilde (§2.2, avstemt i §2.5) | 30 |
| Klasse B-filer | utsatt (§2.3) | 9 |
| Klasse C-filer | eksplisitt utelatt (§2.4) | 13 |
| CSV-filer | endelse `.csv` | 50 |
| HTML-filer | under `Articles/**` | 2 |
| Ukomprimert total | sum `file_size` | 4 796 449 B (~4,6 MB) |
| Komprimert total | sum `compress_size` | 1 099 967 B (~1,05 MB) |
| Komprimeringsforhold | ukomprimert / komprimert | 4,36 |

Tallene gjelder dette referansearkivet. Kontrakten låser ikke noe tall; fase 2 skal
telle per import og lagre tellingene på `linkedin_imports`.

Fravær observert (rapporteres som `missing_optional_file`, ikke feil):
`Projects.csv`, `Courses.csv`, `Honors.csv`, `Patents.csv`, `Publications.csv`,
`Organizations.csv`, `Trainings.csv`.

### 2.2 Klasse A — godkjent kilde for staging og gjennomgang

Kolonner: fil · produktområde · fase 2-staging · tidligst synlig · rolle · evidensnivå · begrunnelse.

| LinkedIn-fil | Produktområde | Fase 2-staging | Tidligst synlig | Rolle | Evidensnivå | Merknad |
| --- | --- | --- | --- | --- | --- | --- |
| `Profile.csv` | Min profil / Om meg | ja | fase 3 | gjennomgåbart forslag per felt | `self_reported` | Sensitive kolonner (`Address`, `Birth Date`, `Zip Code`) leses ikke inn; se §4.1. |
| `Profile Summary.csv` | Min profil | ja | fase 3 | gjennomgåbart forslag | `self_reported` | Ofte tom; tom fil ⇒ `validated` med 0 rader. |
| `Positions.csv` | Karriereoversikt | ja | fase 3 | rollekandidat i Kildegjennomgang | `self_reported` | Brukeroppgitt rolle. Skriver aldri til `career_atoms`. |
| `Education.csv` | Kvalifikasjoner | ja | fase 3 | utdanningskandidat | `self_reported` | |
| `Certifications.csv` | Kvalifikasjoner | ja | fase 3 | sertifiseringskandidat | `self_reported` | Lisensnummer brukes til dedup, vises maskert. |
| `Languages.csv` | Kvalifikasjoner | ja | fase 3 | språkkandidat med nivå | `self_reported` | Mappes til CEFR-nivå i gjennomgang. |
| `Skills.csv` | Kompetanse | ja | fase 3 | kompetansekandidat uten belegg | `self_reported` | Kompetanse belegges indirekte; aldri direkte evidens. |
| `Volunteering.csv` | Karriereoversikt | ja | fase 3 | rollekandidat (frivillig) | `self_reported` | |
| `Recommendations_Received.csv` | Kompetanse / resultater | ja | fase 4 | forslag om kobling til rolle/kompetanse | `third_party_recommendation` | Myk tredjepartsevidens. Aldri automatisk CV-tekst. |
| `Recommendations_Given.csv` | Nettverk | ja | fase 5 | relasjonshistorikk på kontaktkort | `historical_record` | Aldri evidens om brukeren. |
| `Endorsement_Received_Info.csv` | Kompetanse | ja | fase 4 | kompetansesignal (volum + endorser) | `third_party_endorsement` | Tredjepartssignal, ikke belegg. |
| `Endorsement_Given_Info.csv` | Nettverk | ja | fase 5 | relasjonssignal | `user_activity` | |
| `Connections.csv` | Nettverk | ja | fase 5 | kontaktkandidat | `historical_record` | 3 preamblelinjer før header; se §8.5. E-post kun der LinkedIn faktisk har delt den. |
| `Invitations.csv` | Nettverk | ja | fase 5 | relasjonshistorikk | `user_activity` | `Message`-kolonnen er fritekst og logges aldri. |
| `Company Follows.csv` | Nettverk / arbeidsgiverinteresse | ja | fase 5 | interessesignal | `user_preference` | |
| `Jobs/Job Seeker Preferences.csv` | Min profil (jobbønsker) | ja | fase 3 | forslag per preferansefelt | `user_preference` | `Phone Number`-kolonnen leses ikke inn. |
| `SavedJobAlerts.csv` | Min profil (søkeord/varsler) | ja | fase 4 | forslag om søkeord og geografi | `user_preference` | Rå `QUERY_CONTEXT` er strukturert tekst; kun uthentede felt vises. |
| `Jobs/Saved Jobs.csv` | Jobber og muligheter | ja | fase 4 | lead-kandidat | `user_activity` | Aldri automatisk aktiv søknad eller mulighet. |
| `Jobs/Saved Jobs_1.csv` | Jobber og muligheter | ja | fase 4 | lead-kandidat | `user_activity` | Samme kontrakt som over; nummererte varianter slås sammen. |
| `Jobs/Online Job Postings.csv` | Jobber og muligheter | ja | fase 4 | annonsegrunnlag for lead | `historical_record` | `Contact Email` stages ikke. |
| `Jobs/Job Applications.csv` | Søknader (historikk) | ja | fase 4 | historisk søknadskandidat | `historical_record` | `Contact Email`/`Contact Phone Number` stages ikke. `Question And Answers` er fritekst. |
| `Learning.csv` | Læring | ja | fase 5 | læringshendelse | `user_activity` | Læringshendelse, ikke automatisk dokumentert kompetanse. |
| `Events.csv` | Læring / nettverk | ja | fase 5 | aktivitetshistorikk | `user_activity` | |
| `Hashtag_Follows_*.csv` | Interesseprofil | ja | fase 5 | interessesignal | `user_preference` | |
| `Member_Follows_*.csv` | Nettverk | ja | fase 5 | interessesignal | `user_preference` | |
| `Saved_Items_*.csv` | Interesseprofil | ja | fase 5 | interessesignal | `user_activity` | |
| `Articles/**` (HTML) | Publisert innhold | ja | fase 5 | kildegrunnlag for resultat/synlighet | `self_reported` | Ikke radbasert; `source_content_hash`. Fulltekst logges aldri. |
| `Rich_Media.csv` | Publisert innhold | ja | fase 5 | kildegrunnlag | `self_reported` | CSV-basert: `csv_row` + `source_row_hash`. |
| `Causes You Care About.csv` | Min profil (valgfritt) | nei (opt-in) | fase 5 | kun kildegrunnlag | `user_preference` | Kan berøre ideologisk ståsted; krever eget aktivt valg og importeres aldri automatisk. |

### 2.3 Klasse B — utsatt, ikke del av første produktflyt

Leses ikke, stages ikke, normaliseres ikke i fase 2. Registreres kun som
`skipped_deferred` i filinventaret.

`Shares_*.csv`, `Reactions_*.csv`, `Comments_*.csv`, `Votes_*.csv`,
`InstantReposts_*.csv`, `learning_role_play_messages.csv`,
`learning_coach_messages.csv`, `guide_messages.csv`,
`VerifiedExternalCapability.csv`.

Kan senere vurderes for interesseprofil, læring eller publisert innhold.

### 2.4 Klasse C — eksplisitt utelatt

Aldri lest inn, aldri persistert — heller ikke som råpayload, i logger eller i
feilmeldinger. Kun filnavn, størrelse og eksklusjonsårsak registreres.

| Fil | `exclusion_reason` |
| --- | --- |
| `messages.csv` | `private_communications` |
| `Email Addresses.csv` | `contact_detail_source_not_allowed` |
| `PhoneNumbers.csv` | `contact_detail_source_not_allowed` |
| `Whatsapp Phone Numbers.csv` | `contact_detail_source_not_allowed` |
| `Logins.csv` | `security_data` |
| `Security Challenges.csv` | `security_data` |
| `Verifications/**` | `security_data` |
| `Receipts_v2.csv` | `financial_data` |
| `Registration.csv` | `security_data` |
| `LAN Ads Engagement.csv` | `advertising_activity` |
| `Ads Clicked.csv` | `advertising_activity` |
| `Inferences_about_you.csv` | `inferred_sensitive_data` |
| `Ad_Targeting.csv` | `inferred_sensitive_data` |


### 2.5 Avstemming — alle 52 arkivstier med nøyaktig én klasse

Avviket i tidligere utkast (29 + 9 + 13 = 51) skyldtes at raden `Articles/**` i
klasse A-tabellen dekker **to** filer. Korrekt fordeling er derfor
**30 klasse A-filer** (29 tabellrader), 9 klasse B og 13 klasse C = 52.
Ingen fil står uten klasse; ingen fil har mer enn én klasse.

| # | Arkivsti | Klasse |
| --- | --- | --- |
| 1 | `Profile.csv` | A |
| 2 | `Profile Summary.csv` | A |
| 3 | `Positions.csv` | A |
| 4 | `Education.csv` | A |
| 5 | `Certifications.csv` | A |
| 6 | `Languages.csv` | A |
| 7 | `Skills.csv` | A |
| 8 | `Volunteering.csv` | A |
| 9 | `Recommendations_Received.csv` | A |
| 10 | `Recommendations_Given.csv` | A |
| 11 | `Endorsement_Received_Info.csv` | A |
| 12 | `Endorsement_Given_Info.csv` | A |
| 13 | `Connections.csv` | A |
| 14 | `Invitations.csv` | A |
| 15 | `Company Follows.csv` | A |
| 16 | `Jobs/Job Seeker Preferences.csv` | A |
| 17 | `SavedJobAlerts.csv` | A |
| 18 | `Jobs/Saved Jobs.csv` | A |
| 19 | `Jobs/Saved Jobs_1.csv` | A |
| 20 | `Jobs/Online Job Postings.csv` | A |
| 21 | `Jobs/Job Applications.csv` | A |
| 22 | `Learning.csv` | A |
| 23 | `Events.csv` | A |
| 24 | `Hashtag_Follows_997361.csv` | A |
| 25 | `Member_Follows_997361.csv` | A |
| 26 | `Saved_Items_997361.csv` | A |
| 27 | `Rich_Media.csv` | A |
| 28 | `Causes You Care About.csv` | A (opt-in) |
| 29 | `Articles/Articles/available-positions-cisco-norway-henrik-vaage.html` | A |
| 30 | `Articles/Articles/why-apples-tim-cook-just-made-surprise-appearance-ciscos-henrik-vaage.html` | A |
| 31 | `Shares_997361.csv` | B |
| 32 | `Reactions_997361.csv` | B |
| 33 | `Comments_997361.csv` | B |
| 34 | `Votes_997361.csv` | B |
| 35 | `InstantReposts_997361.csv` | B |
| 36 | `learning_role_play_messages.csv` | B |
| 37 | `learning_coach_messages.csv` | B |
| 38 | `guide_messages.csv` | B |
| 39 | `VerifiedExternalCapability.csv` | B |
| 40 | `messages.csv` | C |
| 41 | `Email Addresses.csv` | C |
| 42 | `PhoneNumbers.csv` | C |
| 43 | `Whatsapp Phone Numbers.csv` | C |
| 44 | `Logins.csv` | C |
| 45 | `Security Challenges.csv` | C |
| 46 | `Verifications/Verifications.csv` | C |
| 47 | `Receipts_v2.csv` | C |
| 48 | `Registration.csv` | C |
| 49 | `LAN Ads Engagement.csv` | C |
| 50 | `Ads Clicked.csv` | C |
| 51 | `Inferences_about_you.csv` | C |
| 52 | `Ad_Targeting.csv` | C |

Sum: A = 30, B = 9, C = 13, totalt 52 = antall datafiler = antall kjente filer.
Ukjente filer = 0.

---


## 3. Datakontrakt per produktområde

DTO-ene under er **foreslåtte og additive**. De implementeres ikke i fase 1.

### 3.1 Min profil / Om meg

Kilder: `Profile.csv`, `Profile Summary.csv`, `Jobs/Job Seeker Preferences.csv`,
`SavedJobAlerts.csv`, `Skills.csv`, `Languages.csv`, valgfritt
`Causes You Care About.csv`.

Felt som kan foreslås: profesjonell overskrift, kort presentasjon, bransjer,
faglige kompetanser, språk med nivå, ønskede roller og stillingstitler, ønskede
bransjer, ønsket selskapsstørrelse, arbeidsform og jobbtyper, steder/geografi,
søkeord og varslingspreferanser, drømmearbeidsgivere, offentlige nettsteder.

Felt som **aldri** importeres automatisk: fødselsdato, gate-/postadresse, postnummer,
telefonnummer, pendleradresse, rekrutteringssynlighet (`Open To Recruiters`),
profildeling med jobbannonsør/annonsører, politiske, ideologiske eller sensitive
inferred interests.

Hvert foreslått felt behandles individuelt:

```ts
type FieldDecision = "use_linkedin" | "keep_existing" | "merge" | "dismiss";
```

Standardvalg er alltid `keep_existing`. Ingen felt endres uten eksplisitt beslutning.

### 3.2 Karriereoversikt og kvalifikasjoner

Roller (`Positions.csv`), utdanning (`Education.csv`), sertifiseringer
(`Certifications.csv`), språk (`Languages.csv`), frivillig arbeid
(`Volunteering.csv`), kompetanser (`Skills.csv`).

Alle blir kandidater i Kildegjennomgang. De kan **aldri** skrive direkte til
`career_atoms`; promotering skjer gjennom den kanoniske gjennomgangsflyten.
Kompetanse og eksponering belegges kun indirekte, via rolle eller resultat.

### 3.3 Anbefalinger og kompetansesignal

- `Recommendations_Received.csv`: myk tredjepartsevidens med forfatter, rolle,
  selskap, dato, tekst og LinkedIn-proveniens. Kan foreslå kobling til kompetanse,
  rolle eller resultat, men blir aldri hard evidens eller CV-tekst automatisk.
- `Endorsement_Received_Info.csv`: kompetansesignal med endorser og dato. Signal om
  bredde, ikke belegg.
- `Recommendations_Given.csv`: relasjonshistorikk på kontaktkort. Aldri evidens om
  brukeren.

### 3.4 Jobber og muligheter

- Jobbpreferanser og varsler → forslag til Min profil.
- Lagrede jobber og jobbannonser → lead-kandidater.
- Historiske søknader → historiske søknadskandidater.

En LinkedIn-jobb blir aldri automatisk en aktiv søknad eller mulighet. Brukeren
velger dette eksplisitt.

---

## 4. Proveniens- og evidensregler

### 4.1 Proveniensstruktur per verdi

| Felt | Innhold |
| --- | --- |
| `source_system` | alltid `linkedin_export` |
| `linkedin_import_id` | FK til `linkedin_imports` |
| `source_file` | normalisert arkivsti, f.eks. `Jobs/Saved Jobs.csv` |
| `source_locator_type` | `csv_row` \| `archive_file` \| `html_section` |
| `source_locator` | menneskelesbar lokator, f.eks. `row:42` eller `section:h2[3]` |
| `source_row_number` | kun når `source_locator_type = csv_row` |
| `source_row_hash` | kun når `source_locator_type = csv_row` |
| `source_content_hash` | kun for HTML-artikler og eventuelle fremtidig nedlastede mediefiler |
| `imported_at` | tidspunkt for import i Karrierenmin |
| `source_event_at` | valgfritt: da hendelsen faktisk fant sted (f.eks. `Saved Date`, `Endorsement Date`) |
| `source_recorded_at` | valgfritt: da LinkedIn registrerte eller eksporterte posten |
| `source_url` | når kilden har URL (profil-URL, annonse-URL, artikkel-URL) |
| `source_classification` | `self_reported` \| `third_party_recommendation` \| `third_party_endorsement` \| `user_activity` \| `user_preference` \| `historical_record` |

`Rich_Media.csv` er CSV-basert og bruker `csv_row`, `source_row_number` og
`source_row_hash`. `source_content_hash` brukes ikke for CSV-rader.
`Articles/**` bruker `archive_file` eller `html_section` med `source_content_hash`.

### 4.2 Evidensregler

- Profiltekst, roller, utdanning, sertifiseringer, språk og kompetanser fra LinkedIn
  er `self_reported`.
- Mottatte anbefalinger er `third_party_recommendation`.
- Endorsements er `third_party_endorsement`.
- Ingen av dem gir automatisk `documented` eller `user_attested`. LinkedIn-import
  alene kan ikke produsere en attestert CV-claim.
- AI kan foreslå koblinger og formuleringer, men kan ikke godkjenne dem.
- Tekst fra anbefalinger, artikler, invitasjonsmeldinger, søknadssvar eller
  CV-lignende felt skal aldri logges i klartekst i tekniske logger.

---

## 5. Dedupliseringskontrakt

Ingen dedupliseringsregel sletter eller overskriver eksisterende data. Utfall er
alltid ett av `match`, `possible_duplicate`, `conflict`, `new`.

| Domene | Matchrekkefølge | Automatisk | Utfall ved usikkerhet |
| --- | --- | --- | --- |
| Kontakt | 1) LinkedIn-profil-URL 2) e-post når den allerede er frivillig delt i `Connections.csv` 3) normalisert navn + selskap | kun 1) og 2) gir `match` | 3) gir alltid `possible_duplicate`, aldri automatisk merge |
| Rolle | normalisert arbeidsgiver + normalisert tittel + start/sluttperiode | eksakt treff gir `match` | periodeoverlapp eller avvikende tittel gir `conflict` eller `possible_duplicate` |
| Sertifisering | utsteder + navn + lisensnummer når tilgjengelig | treff på alle tre gir `match` | manglende lisensnummer gir `possible_duplicate` |
| Jobb | 1) annonse-URL 2) normalisert selskap + tittel + lokasjon | 1) gir `match` | 2) gir `possible_duplicate` |
| Anbefaling | forfatter + opprettelsesdato + teksthash | alle tre gir `match` | ellers `new` |

Avvik løses av brukeren i gjennomgangen. Konflikt er en synlig tilstand, ikke en feil.

---

## 6. Personvern, retention og sletting

### 6.1 Lagring av rå arkiv

- Original ZIP lagres i privat storage-bøtte under `{user_id}/…`, kun tilgjengelig
  for eier, i **maksimalt 30 dager** etter opplasting, og slettes umiddelbart når
  importen når `reconciliation_ready` og brukeren har fullført gjennomgangen.
- Klasse C-filer pakkes aldri ut, leses aldri og persisteres aldri — heller ikke
  som råpayload eller innhold i en feilmelding.

### 6.2 Retention for staging

- Rå stagingdata (normaliserte rader per domene) beholdes i **maksimalt 90 dager**
  etter at importen ble `reconciliation_ready`, eller til brukeren sletter importen.
- Fritekstfelt (anbefalingstekst, artikkeltekst, invitasjonsmeldinger, søknadssvar)
  lagres kun i staging, aldri i logger, og aldri i telemetri eller feilrapporter.

### 6.3 Sletting av en LinkedIn-import

Når brukeren sletter en import slettes: rå ZIP, alle `linkedin_import_files`-innhold,
all staging og all fritekst fra denne importen.

For innhold brukeren **allerede har bekreftet** beholdes kun et minimalt, immutabelt
revisjonsspor, slik at bekreftet data aldri står uforklart:

| Felt | Beholdes |
| --- | --- |
| `source_system` | ja (`linkedin_export`) |
| `source_classification` | ja |
| referanse til slettet import eller tombstone | ja |
| kildehash (`source_row_hash` eller `source_content_hash`) | ja |
| slettetidspunkt | ja |
| rå anbefalingstekst, rå artikkeltekst, annen privat kildetekst | **nei** |

Privat kildetekst beholdes aldri av revisjonshensyn alene.

### 6.4 Isolasjon

Brukerens preferanser, nettverk, anbefalinger og historikk deles aldri mellom
brukere. All lesing skjer under RLS med `auth.uid()`; ingen aggregering på tvers av
brukere i fase 2–5.

---

## 7. Brukervalg per behandlingsformål i produktkontrakten

Importen krever eksplisitt valg per behandlingsformål:

| Formål | Dekker |
| --- | --- |
| `profile` | Profile, Profile Summary, jobbønsker, språk, kompetanser |
| `career` | Positions, Education, Certifications, Volunteering, anbefalinger, endorsements |
| `network` | Connections, Invitations, Company Follows, Member Follows, Recommendations Given |
| `jobs` | Saved Jobs, Online Job Postings, Job Applications, SavedJobAlerts |
| `learning` | Learning, Events |
| `content` | Articles, Rich_Media, Saved Items, Hashtag Follows |

Regler:

- Valgene lagres på importen (hvilke formål, av hvem, når, kontraktversjon).
- Data som tilhører et formål brukeren ikke har valgt, stages ikke og blir aldri
  forslag. Filen registreres som `skipped_no_selected_purpose` i filinventaret.
- Valg kan trekkes tilbake senere; da slettes tilhørende staging etter reglene i §6.3.
- Fravær av valg er ikke samtykke. Standard er av.

---

## 8. Preflight og sikkerhetsporter

### 8.1 Grenser (konservative forslag for fase 2)

| Grense | Verdi | Begrunnelse |
| --- | --- | --- |
| Maks komprimert ZIP | 200 MB | referansearkivet er ~1 MB; gir stor margin |
| Maks ukomprimert total | 1 GB | |
| Maks enkeltfil (ukomprimert) | 200 MB | |
| Maks arkivoppføringer | 2 000 | referansearkiv: 52 |
| Maks rader per CSV | 250 000 | største fil i referansearkivet: 12 084 rader |
| Maks tekststørrelse per celle/felt | 64 KB | fritekstfelt som `Summary` og anbefalingstekst |
| Maks komprimeringsforhold | 100:1 | ZIP-bombebeskyttelse; referansearkiv: 4,36:1 |

Grensebrudd på arkivnivå gir `rejected`. Grensebrudd på filnivå gir `rejected` for
den filen og `partially_validated` for importen.

### 8.2 Arkivsikkerhet

- Gyldig ZIP-katalog; ellers `rejected` med `invalid_archive`.
- Path traversal avvises: `..`, absolutte stier, backslash-separatorer, stier som
  normaliserer utenfor arkivroten.
- Dublette arkivstier avvises (`duplicate_archive_path`) — arkivet kan ikke ha to
  oppføringer med samme normaliserte sti.
- Symlink-oppføringer og ikke-regulære oppføringer avvises.
- Ukomprimert størrelse leses fra katalogen **og** håndheves under utpakking
  (streaming-tak), slik at en manipulert katalog ikke omgår grensen.

### 8.3 Tegnsett og innhold

- Forventet UTF-8. BOM strippes før parsing.
- Ugyldige byte-sekvenser: filen får `rejected` med `invalid_encoding` (ingen stille
  erstatning av tegn i data som skal stages).
- Null-byte i CSV gir `rejected` med `null_byte_detected`.

### 8.4 Formelinjeksjon

Verdier som starter med `=`, `+`, `-`, `@`, tab eller CR flagges ved import og
prefikses med apostrof ved enhver senere visning i regneark-kontekst eller CSV-eksport.
Rådata endres ikke; beskyttelsen ligger i visnings-/eksportlaget.

### 8.5 Header-validering

Hver kjent CSV har en forventet headersignatur. Avvik gir `rejected` for filen med
`unexpected_header` og de faktiske kolonnenavnene (kolonnenavn er ikke persondata).

Kjent særtilfelle: **`Connections.csv` har tre preamblelinjer** (`Notes:`, en
forklaringstekst, en tom linje) før den reelle headeren
`First Name,Last Name,URL,Email Address,Company,Position,Connected On`. Parseren må
hoppe over preamble før headervalidering; naiv lesing gir header `Notes:` og
feilklassifiserer hele filen.

Andre observerte signaturer i referansearkivet (utdrag):

| Fil | Header |
| --- | --- |
| `Profile.csv` | First Name, Last Name, Maiden Name, Address, Birth Date, Headline, Summary, Industry, Zip Code, Geo Location, Twitter Handles, Websites, Instant Messengers |
| `Positions.csv` | Company Name, Title, Description, Location, Started On, Finished On |
| `Education.csv` | School Name, Start Date, End Date, Notes, Degree Name, Activities |
| `Certifications.csv` | Name, Url, Authority, Started On, Finished On, License Number |
| `Languages.csv` | Name, Proficiency |
| `Skills.csv` | Name |
| `Volunteering.csv` | Company Name, Role, Cause, Started On, Finished On, Description |
| `Recommendations_Received.csv` | First Name, Last Name, Company, Job Title, Text, Creation Date, Status |
| `Endorsement_Received_Info.csv` | Endorsement Date, Skill Name, Endorser First Name, Endorser Last Name, Endorser Public Url, Endorsement Status |
| `Jobs/Saved Jobs.csv` | Saved Date, Job Url, Job Title, Company Name |
| `Jobs/Job Applications.csv` | Application Date, Contact Email, Contact Phone Number, Company Name, Job Title, Job Url, Resume Name, Question And Answers |
| `Jobs/Job Seeker Preferences.csv` | Locations, Industries, Company Employee Count, Preferred Job Types, Job Titles, Open To Recruiters, Dream Companies, Profile Shared With Job Poster, … , Phone Number |
| `Rich_Media.csv` | Date/Time, Media Description, Media Link |
| `Learning.csv` | Content Title, Content Description, Content Type, Content Last Watched Date, Content Completed At, Content Saved, Notes taken on videos |

Nummererte varianter (`Jobs/Saved Jobs_1.csv`, `*_997361.csv`) matches med
mønster og valideres mot basisfilens signatur.

### 8.5.1 Parserregel `connections_csv_preamble_v1` (versjonert)

Regel-ID: `connections_csv_preamble_v1`. Gjelder `Connections.csv`. Regelversjonen
lagres på filraden (`parser_rule = connections_csv_preamble_v1`) slik at senere
endringer i preamblehåndtering er sporbare per import.

Deterministisk sekvens:

1. Strip BOM. Les inntil `MAX_PREAMBLE_LINES = 10` linjer fra toppen.
2. Hopp over preamble: linjer før den reelle headeren forkastes uten tolkning
   (i referansearkivet tre linjer: `Notes:`, forklaringstekst, tom linje).
   Preamblelinjer leses aldri inn i staging og gjengis aldri i logg eller feilmelding.
3. Finn reell header: første ikke-tomme linje som ved CSV-parsing gir nøyaktig
   den forventede signaturen
   `First Name,Last Name,URL,Email Address,Company,Position,Connected On`
   (sammenligning etter trimming og case-insensitiv match på kolonnenavn).
4. Valider: headeren må ha samme kolonnesett og rekkefølge som signaturen.
5. Avvis på filnivå dersom headeren ikke finnes innen `MAX_PREAMBLE_LINES`:
   filstatus `rejected` med `error_code = connections_header_not_found`.
   Ved funnet, men avvikende header: `rejected` med
   `error_code = unexpected_header` og kun kolonnenavnene (ikke rader).
6. Filnivåfeil avviser aldri hele importen; importen kan bli
   `partially_validated` (§1).

Logging for denne regelen er begrenset til: `file_name`, `parser_rule`,
`preamble_lines_skipped` (antall), `header_line_number`, `rows_read`,
`rows_validated`, `rows_rejected` og `error_code`. Preambletekst, headerinnhold
ved suksess, navn, e-post, URL-er, selskap eller stilling logges aldri.


### 8.6 Tellere og RLS

- Per fil: `rows_read`, `rows_validated`, `rows_rejected`, `rows_excluded`,
  `rows_unknown`, `file_sha256`, `bytes`.
- Per import: aggregerte tellinger fra §2.1 pluss filstatusfordeling.
- RLS: kun eier (`auth.uid() = user_id`) kan se importen, filinventaret, staging og
  forslag. Ingen `anon`-tilgang. Alle nye public-tabeller får `GRANT` i samme
  migrasjon som `CREATE TABLE`.
- Feil- og driftslogger inneholder aldri CV-tekst, anbefalingstekst,
  meldingsinnhold, e-post, telefonnummer eller adresse — kun filnavn, radnummer,
  feilkode og kolonnenavn.

---

## 9. Verifikasjonsrapport

### 9.1 Eksisterende objekter som kan gjenbrukes

| Objekt | Gjenbruk |
| --- | --- |
| `career_atoms` (+ `atom_class`/`attestation` satt av databasen) | endelig mål for promoterte kandidater |
| `career_atom_links` | kobling mellom rolle, resultat og kompetanse |
| `career_atom_link_suggest` / `_decide` / `_override` | forslagshåndtering for koblinger |
| `career_atom_promote_parse_candidate` (mønster) | referansemodell for promotering fra kandidat til atom |
| `career_atom_delete_impact` / `career_atom_delete` | konsekvensoppslag ved sletting |
| `cv_review_progress` (+ `cv_review_progress_advance`, `_sync`) | trinnvis gjennomgangsmodell |
| `atom_enrichment_proposals` / `atom_enrichment_batches` | forslagslag med review-status |
| `contacts` | mål for kontaktforslag, etter brukerbeslutning |
| `job_leads`, `user_opportunities`, `job_applications` | mål for jobbkandidater, etter brukerbeslutning |
| `documents` | mål for artikler/rikt medie-referanser, etter brukerbeslutning |
| Privat storage-bøtte med eier-scopede policyer | lagring av rå ZIP |

### 9.2 Felter som må være additive i senere migrasjoner

- Ny `source_system`-verdi `linkedin_export` i eksisterende proveniensfelt.
- Nye, nullbare proveniensfelt på kandidat-/forslagslaget: `source_locator_type`,
  `source_locator`, `source_row_number`, `source_row_hash`, `source_content_hash`,
  `source_event_at`, `source_recorded_at`, `source_classification`,
  `linkedin_import_id`.
- Revisjonsspor-felt for slettede importer (§6.3) som nullbare kolonner eller egen
  tombstone-tabell.
- Ingen eksisterende kolonne endrer betydning; ingen `NOT NULL` uten default.

### 9.3 Avvik mellom kontrakt og faktisk modell

1. `cv_imports` har verken hash, kontraktversjon, per-fil-tellere eller filnivåstatus.
   Løses ved eget LinkedIn-importlag, ikke ved utvidelse.
2. `contacts` er i dag knyttet til `application_id` og har ingen proveniensfelt.
   LinkedIn-kontakter må derfor gå via eget staging-lag; direkte innskriving er utelukket.
3. `cv_parse_candidates` har `source_type`/`source_ref` som flat streng — for
   LinkedIn trengs den fulle lokatorstrukturen i §4.1.
4. `job_leads` er i dag e-postorientert (`email_connection_id`, `source_message_id`).
   LinkedIn-leads trenger et kildeuavhengig felt eller egen kandidattabell.
5. Det finnes ingen samtykkemodell per behandlingsformål i dag; §7 er ny.
6. `documents` har ingen LinkedIn-proveniens; artikler må lagres som kandidat før de
   eventuelt blir dokumenter.

### 9.4 Anbefalt fase 2-datamodell (kun beskrevet — ikke opprettet)

| Tabell | Innhold |
| --- | --- |
| `linkedin_imports` | user_id, status, `archive_sha256`, `content_manifest_hash`, `contract_version`, valgte formål, tellinger, tidsstempler, `duplicate_of_import_id` |
| `linkedin_import_files` | import_id, arkivsti, klasse (A/B/C), status, `file_sha256`, bytes, radtellere, avvisningsårsak, eksklusjonsårsak |
| `linkedin_profile_staging` | profil- og preferansefelt med full proveniens |
| `linkedin_career_staging` | roller, utdanning, sertifiseringer, språk, frivillig arbeid, kompetanser |
| `linkedin_recommendation_staging` | mottatte/gitte anbefalinger og endorsements |
| `linkedin_network_staging` | kontakter, invitasjoner, følger |
| `linkedin_job_staging` | lagrede jobber, annonser, historiske søknader, jobbvarsler |
| `linkedin_learning_staging` | læringshendelser og arrangementer |
| `linkedin_content_staging` | artikler og rikt medie, med `source_content_hash` |
| `linkedin_reconciliation_decisions` | per felt/entitet: `use_linkedin`/`keep_existing`/`merge`/`dismiss`, med hvem og når |
| `linkedin_import_tombstones` | minimalt revisjonsspor etter sletting (§6.3) |

Alle med `user_id`, RLS på eier, og `GRANT` i samme migrasjon.

### 9.5 Slettelivssyklus (anbefalt)

```text
opplasting → rå ZIP (≤30 dager, slettes ved fullført gjennomgang)
           → staging (≤90 dager etter reconciliation_ready)
           → brukerbeslutning
               ├─ avvist   → slettes med staging
               └─ bekreftet → produktdata beholdes
                              + minimalt revisjonsspor (§6.3)
sletting av import → ZIP + staging + fritekst slettes umiddelbart
                     bekreftet innhold beholdes med tombstone-referanse
```

### 9.6 Avhengigheter mot RLS og kanoniske RPC-er

- All lesing skjer som innlogget bruker under RLS; ingen service-role-lesing der
  bruker-id kommer fra request body.
- Promotering til `career_atoms` må gå gjennom den kanoniske gjennomgangsflyten
  (`cv_review_progress_*`, `career_atom_link_*`) slik at `atom_class` og
  `attestation` fortsatt settes av databasen.
- `career_atom_delete_impact` må utvides til å vise LinkedIn-proveniens i
  konsekvensoppslaget, additivt.

### 9.7 Klasse A-filer bevisst utsatt

| Fil | Utsatt til | Grunn |
| --- | --- | --- |
| `Recommendations_Received.csv`, `Endorsement_Received_Info.csv` | fase 4 | krever ferdig rolle-/kompetansegrunnlag før kobling gir mening |
| `SavedJobAlerts.csv`, `Jobs/Saved Jobs*.csv`, `Jobs/Online Job Postings.csv`, `Jobs/Job Applications.csv` | fase 4 | avhenger av lead-/mulighetsmodellen |
| `Connections.csv`, `Invitations.csv`, `Company Follows.csv`, `Member_Follows_*.csv`, `Recommendations_Given.csv`, `Endorsement_Given_Info.csv` | fase 5 | nettverksmodellen er ikke etablert |
| `Learning.csv`, `Events.csv` | fase 5 | læringshendelse ≠ dokumentert kompetanse; krever egen visning |
| `Articles/**`, `Rich_Media.csv`, `Saved_Items_*.csv`, `Hashtag_Follows_*.csv` | fase 5 | innholds- og interesseprofil kommer sist |
| `Causes You Care About.csv` | fase 5, opt-in | potensielt sensitivt |

### 9.8 Bekreftelse (gjaldt fase 1)

Ved fase 1 var ingen kode endret, ingen migrasjon kjørt, ingen Edge Function deployet,
ingen tabell eller RPC opprettet, og ingen produktdata endret. Den vedlagte eksporten
ble lest read-only og ble ikke lagret eller koblet til noen bruker.

Fase 2 er nå bygget. Faktisk implementert modell, avvik fra §9.4/§9.5 og fullt
testresultat står i §10.

---

## 10. Fase 2: implementert importlag (status og testresultat)

### 10.1 Implementert datamodell

| Objekt | Rolle |
| --- | --- |
| `linkedin_imports` | én rad per opplastet arkiv: `archive_sha256`, `content_manifest_hash`, status, tellinger, `attempt_id`/`heartbeat_at`, `purged_at` |
| `linkedin_import_tombstones` | minimalt revisjonsspor etter sletting (kun hash, formål, tellinger — ingen LinkedIn-tekst) |
| `linkedin_import_purposes` | samtykke per behandlingsformål (§7) |
| `linkedin_import_files` / `linkedin_import_file_purposes` | filinventar med klasse A/B/C, filhash, parserversjon, radtellere, status per formål |
| `linkedin_staging_records` | felles forelder for all mellomlagring: domene, `record_kind`, formål, lokator, `source_identity_hash`, første/siste import |
| `linkedin_profile_/career_/recommendation_/network_/job_/learning_/content_staging` | 1:1 domenerader med hvitlistede felt, `ON DELETE CASCADE` fra forelderen |
| `linkedin_import_stage_records` | mange-til-mange-kobling import ↔ stagingrad, isolert per `attempt_id` |
| `linkedin_storage_delete_queue` | køen for sletting av rå ZIP i storage (kun service_role) |
| `linkedin_import_delete(uuid, text)` | kontrollert sletting (modell B) |
| `linkedin_import_retention_sweep()` | 7 dagers ZIP-retention, 30 min hjerteslag-timeout, 90 dagers staging-purge |

Kodelag (server-only): `contract.ts`, `preflight.server.ts`, `csv.server.ts`,
`normalize.server.ts`, `classify.server.ts`, `domain-mapping.server.ts`,
`stage.server.ts` og den interne ruten
`POST /api/internal/linkedin-import-worker` (POST-only, egen worker-hemmelighet
sammenlignet i konstant tid, saniterte svar).

### 10.2 Avvik fra fase 1-anbefalingen

1. `linkedin_reconciliation_decisions` er **ikke** opprettet — avstemming tilhører fase 3.
2. `duplicate_of_import_id` heter `canonical_import_id`.
3. ZIP-retention er strammet fra 30 til **7 dager**.
4. Staging bevares aldri som tombstone: når siste aktive importkobling forsvinner,
   slettes stagingraden og domeneraden. Tombstone finnes kun på importnivå.
5. Klasse B-filer registreres teknisk (hash, status `deferred`) men stages ikke.

### 10.3 Tilgangskontroll

- RLS er på for alle 15 `linkedin_*`-tabeller.
- `anon` har ingen `GRANT` og ingen policy. Verifisert mot API-et:
  `42501 permission denied` for lesing, `401` for skriving.
- `authenticated` har kun `SELECT`, med policy `auth.uid() = user_id`.
  Verifisert med en annen innlogget bruker: tomt resultat (`[]`) på
  `linkedin_imports`, `linkedin_staging_records` og alle domenetabellene mens
  testdata fantes.
- All skriving skjer med service-role fra worker-ruten. `linkedin_import_delete`
  og `linkedin_import_retention_sweep` er `REVOKE`-t fra `anon`/`authenticated`.

### 10.4 Testresultat (syntetisk arkiv, 16 filer)

| # | Test | Resultat |
| --- | --- | --- |
| 1 | Klassifisering: 12 kjente (11×A, 1×B), 1 ukjent, 3 klasse C | OK |
| 2 | Klasse C leses aldri; kun `excluded_reason_counts` = `{private_messages:1, contact_identifiers:1, advertising:1}` | OK |
| 3 | `Connections.csv`-preamble: 3 linjer hoppes over, header valideres på linje 4, radene lokaliseres til linje 5 og 6 | OK |
| 4 | Staging: 15 rader fordelt på profile 1, career 8, recommendation 1, network 2, job 1, learning 1, content 1 | OK |
| 5 | Datoparsing: `Jan 2015` → 2015-01-01, `01 Jan 2020` → 2020-01-01 | OK |
| 6 | Idempotent kjøring av samme import: fortsatt 15 stagingrader, ny `attempt_id` | OK |
| 7 | Brukerisolasjon: identisk arkiv for bruker B gir 15 egne rader (identitetshash inkluderer bruker) | OK |
| 8 | Andre import med overlappende innhold: 16 rader totalt, 15 deles mellom to importer | OK |
| 9 | Sletting av import 1: 0 stagingrader slettet (delt), tombstone + ZIP-kø opprettet, filinventar fjernet | OK |
| 10 | Sletting av siste aktive importkobling: 16 stagingrader **og** alle domenerader slettet | OK |
| 11 | Reimport etter purge: samme `archive_sha256` tillates på nytt, 15 rader gjenskapt | OK |
| 12 | Aktiv duplikat blokkeres: unik indeks avviser samme hash mens en import er aktiv | OK |
| 13 | Feil worker-hemmelighet → `401`; GET → `405`; ugyldig ZIP → `rejected` / `invalid_archive` | OK |
| 14 | Retention-sweep: 1 ZIP utløpt (7 d), 1 hjerteslag-timeout (30 min), 1 import purget (90 d) | OK |
| 15 | Produktdata: teller på `career_atoms`, `cv_parse_candidates`, `profiles`, `professional_results`, `documents`, `user_career_profiles`, `contacts`, `job_applications` identisk før og etter alle kjøringer | OK |

Alle syntetiske testrader er fjernet etterpå; `linkedin_*`-tabellene står på 0 rader.

### 10.5 Bekreftelse fase 2

Ingen produktdata ble skrevet, endret eller slettet. Staging- og importlaget er
fullstendig isolert: `stage.server.ts` skriver kun til `linkedin_*`-tabeller, og
worker-ruten har ingen kodesti mot atom-, kandidat-, dokument- eller kontakttabeller.
Avstemming og gjennomgang bygges i fase 3 oppå dette laget.

