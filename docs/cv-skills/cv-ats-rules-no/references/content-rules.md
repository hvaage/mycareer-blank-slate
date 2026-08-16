# Innholds-regler

Hvilke seksjoner CV-en skal ha, hva de skal hete, og hvordan innholdet skal struktureres.

## Påkrevde seksjoner

Disse må være med i hver CV som genereres av sokr.online:

1. **Topp/kontaktinfo** (uten seksjon-header)
2. **Profilsammendrag** eller **Sammendrag**
3. **Erfaring** eller **Arbeidserfaring**
4. **Utdanning**

## Anbefalte seksjoner

- **Ferdigheter** eller **Kompetanse**
- **Språk**
- **Sertifiseringer** (hvis relevant)

## Valgfrie seksjoner

- **Prosjekter** (særlig for tech og produktledere)
- **Frivillig arbeid** (særlig for nyutdannede eller relevant frivillig erfaring)
- **Publikasjoner** (akademisk)
- **Referanser** (typisk: "Referanser oppgis ved forespørsel" — ikke list dem)

## Seksjonsoverskrifter — norsk

ATS-systemer matcher seksjonsoverskrifter mot et internt vokabular. Bruk
disse standardiserte termene for best parsing:

| Seksjon | Foretrukket header (norsk) | Alternativ |
|---|---|---|
| Profil | `Profilsammendrag` | `Sammendrag`, `Profil` |
| Arbeidserfaring | `Erfaring` | `Arbeidserfaring`, `Yrkeserfaring` |
| Utdanning | `Utdanning` | `Utdannelse` |
| Ferdigheter | `Ferdigheter` | `Kompetanse`, `Nøkkelkompetanse` |
| Språk | `Språk` | `Språkkunnskaper` |
| Sertifiseringer | `Sertifiseringer` | `Sertifikater`, `Kurs og sertifiseringer` |
| Prosjekter | `Prosjekter` | `Utvalgte prosjekter` |
| Frivillig | `Frivillig arbeid` | `Frivillig` |

## Seksjonsoverskrifter — engelsk

For engelsk-språklige CV-er:

| Seksjon | Foretrukket header (engelsk) |
|---|---|
| Profil | `Summary` |
| Arbeidserfaring | `Experience` |
| Utdanning | `Education` |
| Ferdigheter | `Skills` |
| Språk | `Languages` |
| Sertifiseringer | `Certifications` |
| Prosjekter | `Projects` |
| Frivillig | `Volunteer Experience` |

## Header-styling

- Bruk fet skrift, 12–14 pt
- Samme font som brødtekst, ikke en annen
- Ingen ikoner ved siden av headere
- Ingen understrekning som dekorativ element (kan forstyrre noen ATS-parsere)
- Konsistent kapitalisering — alle headers samme stil (Tittel-stil eller VERSALER, ikke blande)

## Topp/kontaktinfo

På toppen av CV-en, før første seksjon:

```
Henrik Vaage
[Tittel/headline, valgfritt]
Oslo, Norge
+47 XX XX XX XX
hvaage@gmail.com
linkedin.com/in/henrikvaage
```

### Regler

- **Navn:** Førstelinje, fet skrift, 14–18 pt
- **Headline:** Linje 2, valgfritt. Maks 60 tegn. F.eks. "Senior teknologi- og kommersialiseringsleder"
- **Lokasjon:** By og land. Ikke gateadresse.
- **Telefon:** Norsk format `+47 XXX XX XXX` eller `+47 XX XX XX XX`
- **E-post:** En profesjonell adresse. Ikke `kuleguy93@hotmail.com`.
- **LinkedIn:** Brukernavn-URL (`linkedin.com/in/<navn>`), ikke den lange query-string-versjonen
- **Personlig nettside/portfolio:** Hvis relevant for stillingen

### Forbudt i topp

- Fødselsdato eller alder (se `gdpr-personvern.md`)
- Sivilstatus
- Antall barn
- Religion, etnisitet, politisk tilhørighet
- Personnummer eller fødselsnummer (aldri på noen CV)
- Profilbilde (anbefalt fjernet i de fleste norske bransjer)

## Datoformat

### Norsk CV

- Måned-presisjon: `MMM ÅÅÅÅ` med norske månedsforkortelser
- Eksempel: `jan. 2024`, `aug. 2019`
- Tidsperiode: `mai 2019 – jun. 2024`
- Pågående: `jan. 2024 – nå` eller `jan. 2024 – `
- Bruk `–` (en dash), ikke `-` (bindestrek), mellom datoer

### Norske månedsforkortelser

| Måned | Forkortelse |
|---|---|
| januar | jan. |
| februar | feb. |
| mars | mar. |
| april | apr. |
| mai | mai |
| juni | jun. |
| juli | jul. |
| august | aug. |
| september | sep. |
| oktober | okt. |
| november | nov. |
| desember | des. |

Punktum etter måneder med forkortelse (`jan.`), ikke etter `mai` eller `juli` som ikke er forkortet i normal skrivemåte. Vi normaliserer alltid med punktum for konsistens.

### Engelsk CV

- Måned-presisjon: `MMM ÅÅÅÅ` med engelske månedsforkortelser
- Eksempel: `Jan 2024`, `Aug 2019`
- Tidsperiode: `May 2019 – Jun 2024`
- Pågående: `Jan 2024 – present`

### Aldri brukt

- `01/2024` eller `1/24` — formatkonflikt mellom DD/MM og MM/DD over landegrenser
- `2024-01` (ISO) — brukerne forstår, men ATS-er forventer ikke dette
- Bare år (`2019–2024`) — for upresis for moderne ATS-er

## Innholds-struktur per rolle (Erfaring-seksjonen)

```
[Stillingstittel]                                  [datoer]
[Selskap], [Lokasjon]
1–2 setninger som beskriver rollen og selskapets kontekst.

• [Achievement 1]
• [Achievement 2]
• [Achievement 3]
```

### Regler

- Stillingstittel og datoer på samme linje, datoer høyrejustert med tab (ikke mellomrom)
- Selskap og lokasjon på linje 2
- Rollebeskrivelse er valgfri, men anbefalt for kontekst
- 3–6 achievements per rolle. Eldre roller (10+ år tilbake): 0–2 achievements
- Hver bullet starter med stort tegn og slutter med punktum
- Bruk verb i preteritum (`Etablerte`, `Ledet`, `Bygde`) — ikke nåtid eller infinitiv
- Konkrete tall der mulig, men ikke fabrikker

## Innholds-struktur per utdanning

```
[Grad], [studieretning]                            [år]
[Institusjon], [Lokasjon]
[Eventuelt: tese-tittel, karaktersnitt, utmerkelser]
```

## Profilsammendrag

- **Lengde:** 3–5 setninger, totalt 60–100 ord
- **Innhold:**
  - Linje 1: Hvem du er (rolle, antall år, bransjer)
  - Linje 2–3: Hva du har levert eller spesialiserer deg på
  - Linje 4 (valgfritt): Hva du søker
- **Skrivestil:** førsteperson eller upersonlig, ikke tredjeperson. Ikke `Henrik er en…`. Bruk `Senior teknologileder med 25 års erfaring…` eller `Jeg er…` (sjelden i norsk CV-tradisjon).

## Lengde per linje

- Bullets: maks 1–2 linjer hver (omtrent 150 tegn)
- Profilsammendrag: setninger på 15–25 ord, maks 30
- Ingen "wall of text"-paragrafer

## Hierarki

Maks 2 nivåer av hierarki:

```
SEKSJONSHEADER (nivå 1)
  Stillingstittel (nivå 2)
    • Bullet (innhold)
```

Aldri sub-seksjoner under en stilling.

## Konsistens

Hele CV-en skal være på **ett språk**. Ikke bland norsk og engelsk i samme CV.
Hvis kandidaten har internasjonal erfaring, behold språket konsistent og oversett
selskapsnavn ikke (Cisco er Cisco, ikke "Cisco System Norge AS" på norsk og
"Cisco Systems Norway" på engelsk — bruk juridisk navn).

## Lokasjons-format

| Kontekst | Format |
|---|---|
| Norsk by | `Oslo` |
| Norsk by + region | `Oslo, Norge` (kun for utenlandske ATS som trenger landet) |
| Internasjonalt | `London, UK` eller `San Francisco, USA` |

I header for hver rolle: bruk `By, Land` for utenlandske roller.
