# Leveranse B — LinkedIn-datakvalitet, reimport og versjonert avstemming

Backend og datamodell. Ingen Fase 5-flater, ingen automatisk promotering, ingen reell LinkedIn-akseptansetest.

## Preflight — hva som faktisk står i databasen nå

Talt opp før planen ble skrevet:

- Staginglag: 3 632 kontakter, 234 endorsements gitt av deg, 60 mottatt, 24 anbefalinger gitt, 34 mottatt, 95 kompetanser, 12 stillinger, 5 sertifiseringer, 1 utdanning, 1 språk, 2 frivillig.
- Produktlaget er tomt: 0 nettverkskontakter, 0 kontaktidentiteter, 0 anbefalinger, 0 promoteringer, 0 aktiviteter. Ingen produktdata står i fare.
- Forslag: 305 totalt — 300 ubehandlede «jobbsignaler», 4 avviste profilforslag, 1 til avklaring.

Fire reelle avvik bekreftet i koden:

1. Endorsements lagres i samme tabell som anbefalinger, med anbefalingsfelt. Ingen aggregering per kompetanse.
2. Kurs bruker «sist sett»-datoen som fullført-dato, og faller tilbake på beskrivelsestekst som kurs-URL.
3. `career_recommendations` mangler retning, importkilde og forfatteridentitets-hash, så mottatt og gitt kan ikke skilles.
4. `network_contacts` mangler «sist observert», og `next_steps` mangler eier, aktivitetstype og koblinger.

Historikk røres ikke: de 4 avviste og 1 avklaringsforslaget beholdes uendret.

## Det som bygges

### 0. Jobbsignaler ut av det aktive importlaget
Jobbrelaterte LinkedIn-data er utelukket av produktkontrakt v1.1 og skal ikke ligge igjen som innhold noe sted.

- De 300 forslagene settes `superseded` med årsakskode `excluded_by_product_contract_v1_1`.
- Alt innhold som stammer fra jobbsignaler tømmes: kildeøyeblikksbilde, foreslått innhold og sammenligningsdata. Igjen står kun et minimalt revisjonsspor: id, import, domene/type, status, hash, tidspunkt og årsak.
- Tilhørende aktive staging-koblinger fjernes, og jobbsignal-staging slettes når siste aktive kobling er borte.
- Nye importer klassifiserer disse filene som ekskludert allerede før staging, så ingen jobbrelaterte data kan nå avstemming, forslag eller produktdata.
- Egen test beviser både den historiske oppryddingen og blokkeringen ved ny import.

### 1. LinkedIn-endorsements som eget tredjepartssignal
Nytt staginglag skilt fra anbefalinger, med retning (mottatt for din kompetanse / gitt av deg / ukjent) og full proveniens. Kun mottatte kan gi forslag. Gitte og ukjente kan aldri bli produktdata; ukjent retning gir avvik.

Produktlaget lagrer kun et aggregat: antall LinkedIn-støttesignaler per kompetanse, én aktiv rad per bruker og kompetanse. Navn på personer som har gitt støtte lagres aldri i produktdata, logger eller DTO-er. Antallet er aldri en score, et ferdighetsnivå eller en attestering, og kobles bare til en kompetanse du allerede har valgt.

### 2. Anbefalinger med retning
`career_recommendations` utvides additivt med retning (obligatorisk, kun «mottatt» tillatt i produkt), kildesystem, kildeklasse, import-id, kildehash, anbefalingsdato og forfatteridentitets-hash. Duplikater fanges på bruker + forfatteridentitet + teksthash + kildesystem. Gitte anbefalinger blir liggende i staging. Kobling til en nettverkskontakt krever eksplisitt brukerbekreftelse — aldri navnelikhet.

### 3. Nettverk, reimport og selskaper
- «Sist observert» på kontakt; profil-URL eies fortsatt kun av identitetstabellen.
- Ny tabell for kontakt–selskap-observasjoner: observert selskapstekst, eventuell eksplisitt selskapskobling, kildeklasse, observasjonstidspunkt og din egen retting. Ingen automatisk fuzzy-kobling mot registeret.
- Ny bruker-scopet tabell for din relasjon til et selskap: notater, status, prioritet, unik per bruker og selskap.
- Reimport oppdaterer kun staging og overskriver aldri promoterte eller manuelt redigerte felt.

### 3b. Varig nettverksbatch
Nettverksavstemming lagres som en frossen, reviderbar batch — ikke en beregning som gjøres på nytt hver gang.

- Batchen eier bruker, import, kjøring, inndatasignatur, avstemmingsversjon, status, tidspunkter og rene tellere: nye, eksakte identitetsmatcher, mulige dubletter, uten stabil identitet, observert profilendring og ekskluderte. Ingen kontaktdata i aggregatfeltene.
- Radene under batchen peker til staging- eller kontaktidentitet og bærer kategori, foreslått handling, kildehash, eventuell målidentitet, status og årsakskoder.
- Samme inndata gjenbruker samme batch (idempotent) for både første import og reimport.
- Batchen skriver aldri kontakter direkte. Navnelikhet gir «mulig dublett»; eksakt LinkedIn-identitet gir «eksakt treff» eller «observert profilendring».
- En senere massegodkjenning konsumerer nøyaktig denne frosne batchen, aldri en ny ad hoc-beregning.
- RLS og bruker-scopede, sammensatte fremmednøkler på både batch og rader. Fase 5 kan vise batchen; her bygges kun modell og DTO.


### 4. Kurs, sertifisering, språk og læring
Kursmapping rettes: faktisk tittel, tilbyder, fullført-dato med presisjon, og URL kun fra en ekte URL-kolonne. «Sist sett» kan aldri bli fullført-dato. Manglende dato blir «mangler i kilde», uparsbar dato blir «ugyldig kildeverdi» — aldri en oppdiktet dato. Kurs og sertifisering holdes adskilt; credential-id, utsteder og utløpsdato bevares når kilden har dem. Språk, utdanning og frivillig arbeid kontrolleres for riktig type og periodepresisjon.

### 5. Ny avstemmingsversjon
`linkedin_reconciliation_v2`: rent deterministiske regler uten KI, for stillinger, utdanning, kompetanser, sertifiseringer, kurs, språk og frivillig arbeid. Én kildepost får én klassifisering. Parallelle roller hos samme arbeidsgiver holdes separate. Tittel, selskap og periode presses aldri inn som resultat eller kompetanse. Mulig dublett slås aldri sammen automatisk. Nye forslag får forklarbar matchmetode, årsakskoder, kildeidentitet og versjon, og peker på sin forgjenger når det finnes en. Kjøringen er idempotent per bruker, import, formål, inndatasignatur og versjon.

### 6. Aktivitetsfundament
`next_steps` migreres i rekkefølge: nye nullbare felt (eier, aktivitetstype, kontakt, selskap, mulighet), backfill av eier, verifisering av null tomme eiere, søknad blir valgfri, deretter bruker-scopede sammensatte fremmednøkler slik at en aktivitet aldri kan peke på en annen brukers kontakt, mulighet eller søknad. RLS aktiveres. Ingen aktivitets-UI eller «utført»-handling bygges nå.

## Sikkerhet og logging

Alle nye tabeller: RLS på, ingen tilgang for uinnloggede, kun lesing av egne rader for innloggede, ingen direkte skriving fra nettleseren, all skriving via serverruter. Logger inneholder kun identer, faser, tellere og feilkoder — aldri rå CSV, anbefalingstekst, endorser-identitet, kontaktdata, profil-URL eller hemmeligheter.

## Syntetisk testmatrise (kjøres, rulles tilbake)

Alle 27 punktene fra bestillingen, inkludert: mottatt vs. gitt endorsement, at endorser-identitet aldri når produktmodellen, retning på anbefalinger, dublettsperre, eksakt identitetsmatch vs. navnelikhet, reimport som ikke overskriver manuelle rettinger, ingen fuzzy selskapkobling, kursdato- og URL-reglene, kurs vs. sertifisering, parallelle roller, at ny versjon ikke rører behandlet historikk, idempotens, aktivitetsmigrering med null tomme eiere, kryssbruker-sperre, RLS-isolasjon, og før/etter-telling som viser at ingen produktdata endres.

## Leveranse

Preflight- og avviksrapport, migrasjoner med datamodelloversikt, oppdatert feltmapping med faktiske LinkedIn-headere, reglene for den nye avstemmingsversjonen, backend-DTO for nettverksbatch og reimportendringer, RLS- og rettighetsrapport, testresultater, før/etter-tall, oppdatert `docs/linkedin-import-contract-v1.md`, og bekreftelse på at ingen reell LinkedIn-ZIP er brukt.

Stopper etter Leveranse B.

## Teknisk sammendrag

- Nye tabeller: `linkedin_endorsement_staging`, `linkedin_endorsement_signals`, `network_contact_company_relations`, `user_company_relationships`.
- Utvidelser: `career_recommendations` (retning, proveniens, forfatterhash), `network_contacts.last_observed_at`, `next_steps` (eier, type, koblinger, sammensatte FK-er, RLS).
- Kode: `contract.ts` (eget endorsement-domene), `domain-mapping.server.ts` (kurs- og endorsement-mapping), ny `reconciliation/v2/` med deterministiske regler per domene, batch-DTO for nettverk.
- Versjonering: `RECONCILIATION_VERSION = "linkedin_reconciliation_v2"`; berørte `pending_review`-forslag settes `superseded` med årsakskode, behandlede forslag urørt.
