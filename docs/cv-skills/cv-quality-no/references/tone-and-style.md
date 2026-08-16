# Tone og stil for norsk CV-prosa

Disse prinsippene styrer hva som regnes som god skrivestil i CV-bullets,
profilsammendrag og søknadsbrev generert i sokr.online.

## Kjerneprinsipper

### 1. Korte, tydelige setninger

Hver bullet er kort og presis. 12–18 ord er ideelt. Maks 25 ord. Lengre
setninger er nesten alltid signal om at bulletten kan splittes eller komprimeres.

| God | Dårlig |
|---|---|
| `Etablerte Symantec Norge fra null til USD 45 mill. omsetning på fem år.` | `Var sentral i å etablere Symantec Norge gjennom et omfattende strategisk arbeid som over en femårsperiode ledet til at selskapet oppnådde en omsetning på USD 45 mill.` |

### 2. Aktiv form, ikke passiv

Aktiv form har handling og ansvar. Passiv form skjuler hvem som gjorde noe.

| Aktiv | Passiv |
|---|---|
| `Etablerte ny salgsorganisasjon` | `En ny salgsorganisasjon ble etablert` |
| `Reduserte time-to-market med 40 %` | `Time-to-market ble redusert med 40 %` |
| `Bygde teamet fra 0 til 15` | `Teamet ble bygget fra 0 til 15` |

Unntak: når selve handlingen er fokus og handleperson er irrelevant
("Selskapet ble børsnotert i 2021").

### 3. Konkret framfor abstrakt

Tall, prosenter, beløp, tidsperioder. Hvis brukeren har konkrete tall i atoms,
bruk dem. Hvis ikke, fjern fluff istedenfor å skjule manglende tall i abstraksjon.

| Konkret | Abstrakt |
|---|---|
| `Doblet ARR fra USD 1,8 mill. til 3,6 mill. på 14 måneder` | `Drev betydelig vekst i ARR over en periode` |
| `Lukket 12 enterprise-kontrakter med snitt-størrelse NOK 4,5 mill.` | `Bidro til betydelige enterprise-kontrakter` |

### 4. Sterke verb, ikke svake åpninger

Hver bullet starter med et verb som signaliserer eierskap og handling.

| Sterkt | Svakt |
|---|---|
| `Ledet integrasjonen av…` | `Var ansvarlig for integrasjonen av…` |
| `Bygde teamet…` | `Hjalp til med å bygge teamet…` |
| `Etablerte prosessen…` | `Bidro til etablering av prosessen…` |

### 5. Ingen overdrevne adjektiver

| Holde unna | Begrunnelse |
|---|---|
| `dynamisk` | Tomt — beskriver ingenting konkret |
| `innovativ` | Subjektiv — la resultatet snakke |
| `passionate` | Engelsk-isme, klisjé |
| `exceptional`, `outstanding` | Selv-promotering uten støtte |
| `world-class` | Overdrivelse |

### 6. Ingen AI-fluff

Fraser som "har spilt en avgjørende rolle", "transformerte landskapet",
"i tråd med strategiske målsettinger" er signaltapende. Resultatet sier
mer enn floskler.

### 7. Konsistens i verb-tid

| Type rolle | Verb-tid |
|---|---|
| Tidligere rolle (avsluttet) | Preteritum: `Etablerte`, `Bygde`, `Ledet` |
| Nåværende rolle, pågående ansvar | Presens: `Leder`, `Bygger`, `Eier` |
| Nåværende rolle, fortidig prestasjon | Preteritum: `Lanserte i 2024…` |

Aldri bland innenfor samme rolle. Aldri start en bullet med infinitiv (`Å lede`).

### 8. Konsistens i person

Velg upersonlig eller førsteperson — og hold på valget gjennom hele CV-en.

| Upersonlig (anbefalt) | Førsteperson |
|---|---|
| `Etablerte Cisco Norge…` | `Jeg etablerte Cisco Norge…` |

Upersonlig er standard i norsk CV-tradisjon.

## Hvordan disse prinsippene styrer Skill-en

Sjekk-modulene i `scripts/checks/` koder hvert prinsipp:

| Prinsipp | Sjekk-fil |
|---|---|
| Korte setninger | `readability.ts` |
| Aktiv form | (ikke separat sjekk — fanges av verb-strength) |
| Konkret framfor abstrakt | (delvis i ai-tells, delvis manuell) |
| Sterke verb | `verb-strength.ts` |
| Ingen overdrevne adjektiver | `cliches.ts` |
| Ingen AI-fluff | `ai-tells.ts` |
| Verb-tid-konsistens | `tense-consistency.ts` |
| Repetisjon | `repetition.ts` |

## Stil-uavhengig fra ATS-regler

Disse stilprinsippene er om **språk**, ikke om ATS-kompatibilitet. En CV kan
være ATS-perfekt (rette headers, datoer, fonter) og samtidig være full av
svake formuleringer. Tilsvarende kan en CV være velskrevet og samtidig
feile mot ATS-regler.

`cv-quality-no` og `cv-ats-rules-no` jobber sammen og dekker ulike domener.
