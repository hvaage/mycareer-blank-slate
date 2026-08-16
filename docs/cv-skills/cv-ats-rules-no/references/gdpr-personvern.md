# GDPR og personvern-regler for norsk CV

Hva som ikke skal være i en norsk CV, sett fra GDPR og norsk
personopplysningslov. Dette gjelder både for innhold som AI genererer og for
data som brukeren laster opp.

## Hvorfor dette er viktig

Norsk personopplysningslov og GDPR skiller mellom **alminnelige** personopplysninger
og **særlige kategorier**. Sistnevnte (helse, religion, etnisitet, fagforening,
seksuell orientering, politisk oppfatning, biometriske data, genetiske data) krever
eksplisitt rettslig grunnlag for behandling.

I CV-kontekst betyr det: når brukeren legger inn data i sokr.online, og når
sokr.online genererer CV, må vi ikke aktivt gjøre særlige kategorier til en
del av dokumentet med mindre brukeren har eksplisitt samtykke.

Praktisk: vi filtrerer disse dataene fra både input og output.

## Hva som **aldri** skal stå i CV-en

### Identifisering

- **Personnummer / fødselsnummer** — aldri, under noen omstendigheter
- **Passport-nummer** — aldri
- **Skatte-ID-er** — aldri

### Helse

- Diagnoser, fysiske eller mentale
- Funksjonsnedsettelser med mindre brukeren eksplisitt vil framheve dette (egnet for spesifikke jobber)
- Sykdomshistorie

### Følsomme demografiske data

- Religion eller livssyn
- Etnisitet
- Politisk oppfatning eller partitilhørighet
- Fagforeningstilhørighet (med mindre direkte yrkesrelevant, f.eks. fagforeningsleder)
- Seksuell orientering eller kjønnsidentitet
- Familiestatus, sivilstand, antall barn

### Annet

- Ektefelle eller partner-info
- Foreldre, søsken, slektninger (med mindre yrkesrelevant — f.eks. familiebedrift)
- Bostedsadresse (gateadresse) — by/region holder
- Bilskilt, førerkort-nummer (men "førerkort klasse B" er OK om relevant)

## Hva som er greit, men ikke standard

### Profilbilde

- **GDPR:** Lovlig hvis brukeren selv velger å inkludere
- **Norsk skikk:** Mindre vanlig enn for ti år siden. Mange søknader anbefaler nå å droppe det
- **ATS-friction:** Bilder kan forstyrre parsing
- **Konklusjon:** Default er ingen profilbilde i sokr.online. Brukeren kan velge å inkludere.

### Alder eller fødselsår

- **GDPR:** Lovlig
- **Norsk skikk:** Tradisjonelt vanlig, men i moderne CV-er er det vanligere å droppe alder for å redusere aldersbias
- **Konklusjon:** Default er ingen alder. Brukeren kan velge å inkludere.

### Statsborgerskap eller nasjonalitet

- **GDPR:** Lovlig
- **Relevans:** Bare om relevant for stillingen (f.eks. EU-arbeidstillatelse, sikkerhetsklarering)
- **Konklusjon:** Default er ikke inkludert. Bruker kan velge.

## Filtreringsregler i sokr.online

### Ved import av eksisterende CV

Når brukeren laster opp gammel CV (PDF/DOCX) for parsing, og parser ekstraherer
felter:

- **Personnummer:** Kast bort. Aldri lagre som atom. Logg at det ble funnet og fjernet.
- **Fødselsdato:** Lagre, men marker som `sensitive: true`. Ikke inkluder i CV-output med mindre brukeren eksplisitt aktiverer.
- **Sivilstatus, antall barn:** Kast bort. Ikke lagre.
- **Religion/etnisitet/politisk:** Kast bort.
- **Helse-relaterte begrep:** Flagg for review, ikke automatisk lagre.

### Ved AI-generering av CV-tekst

AI skal aldri inkludere disse i output:

- Antagelser om alder basert på uteksamineringsår
- Antagelser om sivilstatus eller barn
- Antagelser om religion eller etnisitet basert på navn
- Helse-spekulasjon basert på karriere-pause

Hvis brukeren har gitt slik informasjon i atoms (med eksplisitt samtykke), skal
den fortsatt ikke være med i CV-en med mindre brukeren har bekreftet "inkluder
dette i CV" på det spesifikke feltet.

### Ved opplasting til ATS

Vi kontrollerer ikke ATS-en, men vi sørger for at filen vi genererer ikke
inneholder personnummer eller andre forbudte data — selv om brukeren har
forsøkt å legge dem inn manuelt.

## Samtykke-håndtering

For data som er valgfri men lovlig:

- Profilbilde: brukeren laster opp eksplisitt og velger å inkludere
- Alder: brukeren toggler "inkluder fødselsår" i CV-builder
- Nasjonalitet: brukeren toggler "inkluder statsborgerskap" i CV-builder

Hvert valg lagres i `cv_consent_log`-tabellen med tidspunkt og hva som ble
samtykket til. Brukeren kan trekke samtykke tilbake når som helst.

## Referanser

Personlige referanser (navn + telefon + e-post til tidligere sjef):

- **GDPR-implikasjon:** Du behandler personopplysninger om referansene
- **Krav:** Referansene må vite at deres data deles
- **Praksis:** Skriv `Referanser oppgis ved forespørsel` i CV-en. Lagre referanseliste som separat dokument som deles direkte med rekrutterer ved forespørsel.

I sokr.online lagrer vi referanseliste i `documents`-tabellen med
`document_type='referanseliste'`, separat fra CV-en.

## Diskriminerings-perspektiv

Selv om visse data er lovlige å inkludere (alder, profilbilde, nasjonalitet),
kan inklusjon påvirke kandidaten negativt på grunn av ubevisst bias hos
rekrutterer eller hiring manager.

Sokr.online sin default-tilnærming er **å redusere bias-overflate**:

- Ingen profilbilde som default
- Ingen alder/fødselsår som default
- Ingen sivilstatus, barn, religion, etnisitet
- Ingen referanser med navn (oppgis ved forespørsel)

Brukeren kan overstyre dette per CV hvis de vurderer at inklusjon er hensiktsmessig
for en spesifikk stilling.

## Når sokr.online deler data eksternt

- Ved generering av CV som lastes ned: brukeren kontrollerer hva som er med
- Ved AI-prosessering (Claude API): kun atoms som er nødvendige for oppgaven sendes med
- Ved third-party tjenester: ingen automatisk videresending. Eventuelle integrasjoner krever eksplisitt samtykke.

## Sletting

Når brukeren sletter en konto eller en CV:

- Atoms slettes fra `cv_evidence_atoms`
- Genererte CV-er slettes fra `documents`
- Filer i Supabase Storage slettes
- AI-prosesseringslogger med personlig innhold slettes innen 30 dager

Edge-funksjonen `delete-account` håndterer dette.

## Oppsummering

Default-CV fra sokr.online inneholder:

- Navn, e-post, telefon, by, LinkedIn-URL
- Profilsammendrag
- Erfaring, utdanning, ferdigheter, språk, sertifiseringer

Default-CV fra sokr.online inneholder **ikke**:

- Personnummer, fødselsdato, sivilstand, barn, religion, etnisitet, helse,
  profilbilde, gateadresse, referansenavn, foreldre/søsken-info

Brukeren kan eksplisitt aktivere visse felt (profilbilde, fødselsår,
nasjonalitet) for spesifikke CV-er.
