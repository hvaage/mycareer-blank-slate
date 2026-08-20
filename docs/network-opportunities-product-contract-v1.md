# Nettverk og muligheter — produktkontrakt v1

Status: forslag til godkjenning. Normativ for all senere implementering av modulen «Nettverk og muligheter».
Versjon: 1.0 (2026-08-20). Språk i produktet: norsk (bokmål).

Dette dokumentet er kilde-til-produkt-kontrakten for fem flater: **Oversikt, Selskaper, Kontakter, Muligheter, Aktiviteter**.
Ingen migrasjon og ingen UI bygges før dokumentet er godkjent.

---

## 0. Grunnregler

### 0.1 Kildeklassifisering (normativ)

Hvert felt som vises i modulen skal ha nøyaktig én kildeklasse:

| Kode | Kildeklasse | Betydning |
| --- | --- | --- |
| `user_input` | Brukeroppgitt | Brukeren har skrevet eller bekreftet verdien selv. |
| `linkedin_observation` | LinkedIn-observasjon | Observert i en LinkedIn-eksport på et gitt tidspunkt. Aldri «bekreftet». |
| `register` | Brønnøysund/arbeidsgiverregister | Offentlig registerdata. |
| `employer_analysis` | Arbeidsgiveranalyse | Modellgenerert analyse med kildeliste. Merkes synlig som KI-generert. |
| `activity` | Aktivitet | Utledet av brukerens egne registrerte aktiviteter og søknader. |

Regler:

- LinkedIn-observasjon presenteres alltid med «Kilde: LinkedIn» og «Sist observert: <dato>». Den fremstilles aldri som verifisert kontaktdata.
- Ordet «attestering» brukes **aldri** om LinkedIn-data. LinkedIn-signaler er tredjepartssignal og er aldri `documented`, `verified` eller `user_attested`.
- Ord som «verifisert», «bekreftet» og «kvalitetssikret» brukes ikke om KI-genererte eller importerte artefakter.
- Arbeidsgiveranalyse vises aldri uten kilde og analysetidspunkt.

### 0.2 Tidsstempler

Hver informasjonsgruppe viser minst ett av:

- `observed_at` — når kilden observerte verdien (LinkedIn-eksportens dato, registerets uttrekk).
- `imported_at` — når verdien kom inn i systemet.
- `updated_at` — når brukeren sist endret verdien.
- `analyzed_at` — når analysen ble kjørt.

### 0.3 Datatilgjengelighet (normativ DTO-kontrakt)

Alle UI-DTO-er skiller mellom fem tilstander per informasjonsgruppe. Frontend skal aldri utlede tilstanden fra `null`:

| Tilstand | Kode | Visning |
| --- | --- | --- |
| Data finnes | `present` | Verdien vises med kilde og tidsstempel. |
| Data mangler i kilden | `missing_in_source` | «Ikke oppgitt i kilden». |
| Ikke importert for valgt formål | `not_imported` | «Ikke importert. Velg formålet ved neste import.» med lenke til import. |
| Ikke ennå analysert | `not_analyzed` | «Ingen analyse kjørt» med handling for å starte analyse. |
| Utløpt / ikke fersk | `stale` | Verdien vises dempet med «Sist observert <dato>» og oppdateringshandling. |

DTO-form: `{ state: DataState, value?: T, source: SourceClass, observed_at?, imported_at?, analyzed_at? }`.

### 0.4 Kildeavgrensning

Følgende importeres **aldri**, verken til staging eller produkt:

- Jobbsignaler og jobbsøkeraktivitet fra LinkedIn (søknader, lagrede jobber, jobbvarsler, jobbsøkerpreferanser).
- Annonseklikk og inferert annonseprofil.
- Navn på personer som har gitt endorsements (kun aggregert antall promoteres).

`contacts` (søknadsbundne kontakter) er **ikke** nettverksregister. Nettverksregisteret er `network_contacts` + `network_contact_identities`.

### 0.5 Eierskap av objekter

| Produktobjekt | Eiertabell | Merknad |
| --- | --- | --- |
| Nettverkskontakt | `network_contacts`, identiteter i `network_contact_identities` | Tenant-scope via `user_id`. |
| Selskap | `companies` | Delt registerobjekt; brukerens relasjon ligger i koblingstabeller. |
| Mulighet | `user_opportunities` (+ `canonical_opportunities`, `source_postings`) | Brukerens eget muligheteobjekt. |
| Søknad | `applications` | Brukerens søknadsprosess. |
| Dokument | `documents` | Kobles til søknad/mulighet. |
| Aktivitet | `next_steps` (utvides, se 6.5), `interviews` | Aktiviteter og intervjuer. |
| Anbefaling mottatt | `career_recommendations` | Kun mottatte anbefalinger. |
| Endorsement-signal | `linkedin_endorsement_signals` (ny, Leveranse B) | Aggregert antall per kompetanse. |

---

## 1. Flate: Oversikt

### 1.1 Hva som vises

| Element | Felt | Eier | Kildeklasse | Tidsstempel |
| --- | --- | --- | --- | --- |
| KPI «Trenger oppfølging» | antall aktiviteter forfalt eller forfaller i dag | `next_steps` | `activity` | `due_date` |
| KPI «Aktive muligheter» | antall muligheter i aktiv status | `user_opportunities` | `user_input` | `updated_at` |
| KPI «Varme kontakter» | antall kontakter med aktivitet siste 90 dager | `network_contacts` + `next_steps` | `activity` | siste aktivitet |
| KPI «Intervjuer» | kommende intervjuer | `interviews` | `user_input` | `scheduled_at` |
| Nylig relevante selskaper | navn, siste hendelse | `companies` + aktivitet | `register` / `activity` | siste hendelse |
| Aktivitetsstrøm | siste og kommende aktiviteter | `next_steps` | `activity` | `due_date`, `completed_at` |
| Forslag til aktivitet | KI-forslag, ikke opprettet | forslagslager (Leveranse B) | `employer_analysis` | `created_at` |

### 1.2 Regler

- Alle fire KPI-ene er **lenker** til den filtrerte underlisten de teller. Et tall uten lenke er kontraktsbrudd.
- Standardbildet viser bare nylig relevante selskaper og aktiviteter, ikke hele registeret.
- KI-forslag til aktivitet er forslag til godkjenning. Ingen aktivitet opprettes automatisk.

### 1.3 Redigerbart / krever brukerhandling

- Ingenting på Oversikt er direkte redigerbart.
- Eksplisitt brukerhandling: godkjenne et aktivitetsforslag (krever frist før det opprettes).

### 1.4 Tom- og mangeltilstand

- Ingen kontakter og ingen muligheter: én startflate med to handlinger — importer LinkedIn, eller registrer første mulighet.
- KPI uten datagrunnlag viser `0` med forklarende undertekst, aldri tom rute.

---

## 2. Flate: Selskaper

### 2.1 Minimumsmodell for Selskap (normativ)

- Registerprofil og arbeidsgiveranalyse der data finnes
- Brukerens kontakter i selskapet
- Muligheter, søknader og dokumenter
- Aktiviteter og neste steg
- Kilde og ferskhet per informasjonsgruppe

### 2.2 Feltkontrakt

| Informasjonsgruppe | Felt | Eier | Kildeklasse | Tidsstempel | Redigerbart |
| --- | --- | --- | --- | --- | --- |
| Registerprofil | `name`, `organisasjonsnummer`, `industry`, `size_estimate`, `country`, `ownership_type` | `companies` | `register` | `brreg_matched_at` | Nei |
| Arbeidsgiverinnsikt | `employer_analysis_v2`, dimensjonsskår, kildeliste | `companies`, `employer_reports` | `employer_analysis` | `employer_analysis_rated_at` | Nei |
| Brukerens relasjon | notater, status, prioritet | brukerens egne felt | `user_input` | `updated_at` | Ja |
| Kontakter i selskapet | navn, rolle | `network_contacts` | `linkedin_observation` / `user_input` | observert/oppdatert | Ja (kontaktobjektet) |
| Muligheter | stilling, status | `user_opportunities` | `user_input` | `updated_at` | Ja |
| Søknader | status, dato | `applications` | `user_input` | `updated_at` | Ja |
| Dokumenter | tittel, type | `documents` | `user_input` | `updated_at` | Ja |
| Aktiviteter og neste steg | type, frist, status | `next_steps` | `activity` | `due_date` | Ja |

### 2.3 Lenkbare detaljer

Kontakt → kontaktside. Mulighet → mulighetsside. Søknad → søknadsside. Dokument → dokumentvisning. Aktivitet → aktivitetsdetalj.

### 2.4 Tom- og mangeltilstand

- Ingen registertreff: `missing_in_source` med handling «Koble til register».
- Ingen analyse: `not_analyzed` med handling «Kjør arbeidsgiveranalyse».
- Ingen kontakter: `not_imported` når LinkedIn-nettverk ikke er importert, ellers `present` med tom liste og forklaring.

---

## 3. Flate: Kontakter

### 3.1 Minimumsmodell for Kontakt (normativ)

- Navn
- Nåværende rolle og selskap når kjent
- LinkedIn-profil-URL når tilgjengelig
- Tilkoblingsdato
- Sist observert i LinkedIn-eksport
- Kontaktens selskapskoblinger
- Aktiviteter og neste aktivitet
- Eventuelle mottatte anbefalinger, tydelig som tredjepartsinformasjon
- Eventuelle LinkedIn-støttesignaler på brukerens kompetanser som aggregert antall, ikke navn på personer

### 3.2 Feltkontrakt

| Felt | Eier | Kildeklasse | Tidsstempel | Redigerbart |
| --- | --- | --- | --- | --- |
| Navn | `network_contacts.display_name` | `linkedin_observation` ved import, `user_input` etter redigering | `observed_at` / `updated_at` | Ja |
| Rolle | `network_contacts.headline` | som over | som over | Ja |
| Selskap | `network_contacts.company` | som over | som over | Ja |
| LinkedIn-profil-URL | `network_contact_identities` (`identity_kind = 'linkedin_profile_url'`) | `linkedin_observation` | `created_at` | Nei (identitet endres ikke manuelt) |
| Tilkoblingsdato | `network_contacts.connected_on` | `linkedin_observation` | eksportdato | Nei |
| Sist observert | `network_contacts.last_observed_at` (nytt felt, Leveranse B) | `linkedin_observation` | `observed_at` | Nei |
| Selskapskoblinger | kontakt↔selskap-kobling (ny, Leveranse B) | `linkedin_observation` / `user_input` | observert | Ja |
| Aktiviteter / neste aktivitet | `next_steps` | `activity` | `due_date`, `completed_at` | Ja |
| Mottatte anbefalinger | `career_recommendations` (kun `direction = received`) | `linkedin_observation` | `recommended_on` | Nei |
| Endorsement-signal | `linkedin_endorsement_signals` (aggregert antall) | `linkedin_observation` | `observed_at` | Nei |
| Notater | kontaktnotat | `user_input` | `updated_at` | Ja |

### 3.3 Regler

- Navn og selskap er lenkbare: selskap → selskapsside, kontakt → kontaktside.
- LinkedIn-data vises alltid med kilde og «sist observert», aldri som bekreftet kontaktdata.
- Endorsements vises kun som aggregert antall på **brukerens egne kompetanser**. Personnavn lagres ikke og vises ikke i produktlaget.
- Mottatte anbefalinger merkes som tredjepartsinformasjon. Gitte anbefalinger vises ikke i brukerens egen kompetanseprofil.
- Ingen anbefaling og intet endorsement brukes automatisk i CV eller søknad.

### 3.4 Krever eksplisitt brukerhandling

- Promotering fra staging til nettverksregister (masseoperasjon, én bekreftelse etter oppsummering).
- Sammenslåing av mulig dublett.
- Godkjenning av endringsforslag på allerede promotert tittel eller selskap.

### 3.5 Tom- og mangeltilstand

- Nettverk ikke importert: `not_imported`.
- Kontakt uten stabil LinkedIn-identitet: merkes «Ingen stabil LinkedIn-identitet», kan ikke automatisk kobles ved reimport.
- Rolle/selskap ikke i eksporten: `missing_in_source`.

---

## 4. Flate: Muligheter

### 4.1 Minimumsmodell for Mulighet (normativ)

- Stilling, selskap og annonsekilde
- Kontaktperson fra annonse som eget kontaktobjekt når tilgjengelig
- Preferanse- og kompetansematch som separate måltall
- Dokumenter brukt
- Aktivitetstidslinje og neste aktivitet
- Brukerens kontakter i selskapet
- Arbeidsgiverinnsikt og datadekning

### 4.2 Feltkontrakt

| Felt | Eier | Kildeklasse | Tidsstempel | Redigerbart |
| --- | --- | --- | --- | --- |
| Stilling | `user_opportunities.card_title` | annonsekilde | `card_published_at` | Ja |
| Selskap | `user_opportunities.card_company` → `companies` | annonsekilde / `register` | `updated_at` | Ja |
| Annonsekilde og URL | `card_source`, `card_display_url`, `card_raw_url` | annonsekilde | `card_published_at` | Nei |
| Kontaktperson fra annonse | eget kontaktobjekt i `network_contacts` med kobling til muligheten | `user_input` (fra annonse) | `created_at` | Ja |
| Preferansematch | eget måltall | `user_input` + modell | `screening_evaluated_at` | Nei |
| Kompetansematch | `relevance_score` / `ai_score` med `match_score_version` | `employer_analysis` | `ai_scored_at` | Nei |
| Dokumenter brukt | `documents.opportunity_id` | `user_input` | `updated_at` | Ja |
| Aktivitetstidslinje | `next_steps`, `interviews` | `activity` | `due_date` | Ja |
| Kontakter i selskapet | `network_contacts` | `linkedin_observation` | observert | Ja |
| Arbeidsgiverinnsikt | `companies.employer_analysis_v2` | `employer_analysis` | `employer_analysis_rated_at` | Nei |

### 4.3 Regler

- Overskrift viser **stilling først**, selskap deretter.
- Preferansematch og kompetansematch er to atskilte måltall og slås aldri sammen til én score.
- En lead blir aldri automatisk søknad eller mulighet. Promotering krever eksplisitt brukerhandling.

### 4.4 Tom- og mangeltilstand

- Ingen kontaktperson i annonsen: `missing_in_source`.
- Ingen arbeidsgiveranalyse: `not_analyzed` med handling.
- Ingen dokumenter: tom liste med handling «Lag CV/søknad».

---

## 5. Flate: Aktiviteter

### 5.1 Feltkontrakt

| Felt | Eier | Kildeklasse | Redigerbart |
| --- | --- | --- | --- |
| Type | `next_steps.activity_kind` (nytt felt) | `user_input` | Ja |
| Knytning til kontakt/selskap/mulighet | `next_steps.contact_id`, `company_id`, `opportunity_id` (nye felt) | `user_input` | Ja |
| Prioritet | `next_steps.priority` | `user_input` | Ja |
| Forfallsdato / «om X dager» | `next_steps.due_date` | `user_input` | Ja |
| Status | `next_steps.completed` | `user_input` | Ja |
| Gjennomført-tidspunkt | `next_steps.completed_at` | `activity` | Nei (settes ved handling) |

### 5.2 Regler

- Å markere en aktivitet som utført lagrer faktisk dato og flytter den til gjennomført historikk.
- KI-genererte aktivitetsforslag må godkjennes **og få en frist** før de opprettes i aktivitetslisten.
- Aktivitet uten knytning er tillatt, men vises med «Ikke knyttet» og handling for å knytte.

### 5.3 Tomtilstand

- Ingen aktiviteter: forklarende tomtilstand med handling «Legg til aktivitet», ikke en tom tabell.

---

## 6. Datamatrise: kilde → staging → forslag → produktobjekt → UI-flate

| Informasjonstype | Kilde | Staging | Forslag | Promoterbart produktobjekt | UI-flate |
| --- | --- | --- | --- | --- | --- |
| Stilling/rolle | LinkedIn Positions | `linkedin_career_staging` | `linkedin_reconciliation_proposals` (`career`) | `career_atoms` (rolle) | Min profil → Erfaring |
| Utdanning | LinkedIn Education | `linkedin_career_staging` | ja | `career_atoms` | Min profil |
| Kompetanse | LinkedIn Skills | `linkedin_career_staging` | ja | `career_atoms` (kompetanse) | Min profil |
| Endorsement-signal | LinkedIn Endorsements | `linkedin_recommendation_staging` → eget signalstaging | ja, aggregert | `linkedin_endorsement_signals` (kompetanse, antall, kilde, observert) | Min profil (aggregert), Kontakt |
| Anbefaling mottatt | LinkedIn Recommendations Received | `linkedin_recommendation_staging` (`direction = received`) | ja | `career_recommendations` | Kontakt, Min dokumentasjon |
| Anbefaling gitt | LinkedIn Recommendations Given | `linkedin_recommendation_staging` (`direction = given`) | nei | ingen | Vises ikke i kompetanseprofil |
| Kontakt | LinkedIn Connections | `linkedin_network_staging` | oppsummering, ikke ett forslag per rad | `network_contacts` + `network_contact_identities` | Kontakter |
| Selskap | Brønnøysund/arbeidsgiverregister | — | — | `companies` | Selskaper |
| Arbeidsgiverinnsikt | Arbeidsgiveranalyse | — | — | `companies.employer_analysis_v2`, `employer_reports` | Selskap, Mulighet |
| Kurs | LinkedIn Learning | `linkedin_learning_staging` | ja | `career_atoms` (kvalifikasjon) | Min profil |
| Innhold/artikler | LinkedIn Articles/Shares | `linkedin_content_staging` | ja | `documents` (portefølje) | Min dokumentasjon |
| Mulighet | Annonsekilder (Careerjet, NAV, e-post) | `source_postings` | screening | `user_opportunities` | Muligheter |
| Aktivitet | Brukerhandling / KI-forslag | — | forslag krever godkjenning og frist | `next_steps` | Aktiviteter |
| Jobbsignaler, annonseklikk, inferert annonseprofil | LinkedIn | **importeres aldri** | — | — | — |

Kursfeltene leses fra riktige kildekolonner: kursnavn, tilbyder, faktisk fullført-dato og kurs-URL. «Sist sett»-kolonnen brukes aldri som fullført-dato.

---

## 7. Normativt vedlegg: «Skjermatferd for Nettverk og muligheter v1»

### 7.1 Modul og navigasjon

- «Nettverk og muligheter» ligger under «Min karriere», før «Marked».
- Nivå-2-navigasjon: Oversikt, Selskaper, Kontakter, Muligheter, Aktiviteter.
- Globalt søk gjelder brukerens eget tenant og dekker kontakt, selskap og mulighet.
- Lenker mellom kontakt, selskap, mulighet, dokument og aktivitet åpner korrekt detaljside.
- «Tilbake» returnerer brukeren til forrige kontekst, ikke alltid til registerets hovedliste.

### 7.2 Arbeidsflate

- Desktopflatene er kompakte arbeidsflater, ikke lange markeds- eller landingssider.
- Detaljsider bruker faste paneler; innhold ruller inne i panelet ved behov.
- Paneler kan kollapses til én linje. Panelets overskrift står fast så lenge panelet er åpent.
- Mobil har samme informasjonsprioritering uten horisontal overflyt.

### 7.3 Oversikt

- KPI-ene «Trenger oppfølging», «Aktive muligheter», «Varme kontakter» og «Intervjuer» er alltid lenker til filtrerte underlister.
- Bare nylig relevante selskaper og aktiviteter vises i standardbildet.
- KI-forslag til aktivitet er forslag til godkjenning, aldri automatisk registrerte aktiviteter.

### 7.4 Kontakt

- Kontaktkortet viser identitet, rolle, selskap, LinkedIn-observasjon, siste aktivitet, neste aktivitet, relasjonsopplysninger og eventuelle tredjepartssignaler.
- Navn og selskap er lenkbare.
- LinkedIn-data merkes med kilde og «sist observert», og presenteres aldri som bekreftet kontaktdata.

### 7.5 Selskap

- Selskapssiden viser registerdata, arbeidsgiverinnsikt når tilgjengelig, brukerens kontakter, muligheter, dokumenter, aktivitet og neste steg.
- Arbeidsgiverinnsikt, registerdata og brukerens egen relasjon har tydelig ulike kildeetiketter.
- Manglende analyse eller registerdekning har eksplisitt tomtilstand.

### 7.6 Mulighet

- Overskriften viser stilling først og selskap deretter.
- Kontaktperson fra annonse er et eget kontaktobjekt når den finnes.
- Preferansematch og kompetansematch vises som separate måltall.
- Dokumenter brukt, annonse-URL, tidslinje, neste aktivitet og relevante kontakter er direkte tilgjengelig.
- Lead blir aldri automatisk søknad eller mulighet uten eksplisitt brukerhandling.

### 7.7 Aktiviteter

- Aktivitet har type, knytning til kontakt/selskap/mulighet, prioritet, forfallsdato eller «om X dager», status og gjennomført-tidspunkt.
- Å markere aktivitet som utført lagrer faktisk dato og flytter den til gjennomført historikk.
- KI-genererte aktivitetsforslag må godkjennes og få en frist før de opprettes i aktivitetslisten.

### 7.8 Datatilgjengelighet

Alle UI-DTO-er skiller mellom de fem tilstandene i 0.3: data finnes, data mangler i kilden, data er ikke importert for valgt formål, data er ikke ennå analysert, data er utløpt eller ikke lenger fersk.

### 7.9 Designreferanse

Vedlegget lenker til godkjent wireframe-/designreferanse: `docs/design/network-opportunities-wireframe-v1.md` (leveres og godkjennes sammen med denne kontrakten). Referansen illustrerer panelatferd, kildeetiketter og de fem datatilstandene. Den er referanse, ikke produksjonskode.

---

## 8. Kjente avvik i dagens datamodell (må lukkes i Leveranse B)

Disse er verifisert mot dagens skjema og er forutsetninger for kontrakten:

1. `network_contacts` mangler felt for LinkedIn-profil-URL i selve raden (identitet ligger i `network_contact_identities`), samt `last_observed_at`. Begge kreves av kontaktmodellen.
2. Det finnes ingen kontakt↔selskap-kobling; `network_contacts.company` er kun tekst.
3. Det finnes ingen tabell for endorsement-signaler; endorsements havner i dag i `linkedin_recommendation_staging` sammen med anbefalinger.
4. `next_steps` er kun bundet til `application_id` og mangler `activity_kind`, `contact_id`, `company_id`, `opportunity_id` og `user_id`.
5. `career_recommendations` skiller ikke mottatte fra gitte anbefalinger i egen kolonne.

Kontrakten er godkjenningsgrunnlag. Leveranse A og B implementerer den; UI bygges først etter at kontrakt, A, B og akseptansetesten er godkjent.
