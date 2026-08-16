# Leselighet: setningslengde og -struktur

Tekniske retningslinjer for hva som regnes som lesbar tekst i CV-kontekst.

## Setningslengde

| Tekst-type | Ideal | Maks |
|---|---|---|
| Bullet (achievement) | 12–18 ord | 25 ord |
| Profilsammendrag-setning | 15–22 ord | 30 ord |
| Søknadsbrev-setning | 18–25 ord | 35 ord |

For lange setninger:
- Vanskelige å skanne raskt
- Skjuler ofte at innholdet er svakt
- Reduserer impact av nøkkelord

## Setningsstruktur

### Foretrukket: subjekt → verb → objekt

Norsk er et SVO-språk. Hold strukturen enkel, særlig i bullets.

| God | Komplisert |
|---|---|
| `Etablerte Symantec Norge fra null til USD 45 mill.` | `Symantec Norge ble, gjennom en prosess som varte i fem år og innebar å bygge organisasjonen fra grunnen, etablert med en avsluttende omsetning på USD 45 mill.` |

### Subordinasjon (leddsetninger)

Maksimalt 1–2 leddsetninger per CV-bullet. Innfor søknadsbrev og
profilsammendrag er 2–3 OK.

Tegn på for mye subordinasjon:
- Mange `som`/`at`-konjunksjoner i samme setning
- Setningen krever to gjenlesninger for å bli klar
- Du kan ikke holde stemmen oppe gjennom hele setningen ved opplesning

### Hovedverb tidlig

Verbet bør komme tidlig — ikke begrav det bak lange substantivfraser.

| God | Begrav verbet |
|---|---|
| `Reduserte time-to-market med 40 %.` | `Time-to-market for produktets tre hovedlinjer ble redusert med 40 %.` |

## Negative mønstre å fange

### 1. Kjedelig rekkefølge av leddsetninger

`som`-leddsetninger som hekter på hverandre:

> "Bygde et team som var ansvarlig for å levere prosjekter som dekket flere
> avdelinger, som hadde ulike prioriteter, som krevde koordinering."

Bryt opp eller komprimer.

### 2. Tunge substantivfraser

Norsk er flink til å lage substantivfraser. Bruk dem sparsomt:

- `gjennomføringsfase` → ikke nødvendigvis dårlig
- `gjennomføringsfase-arbeidet` → overkomplisering
- `prosjektgjennomføringsmandatet` → for tungt

### 3. Innskudd

Lange parenteser eller `–` … `–` -innskudd som bryter setningsflyten:

> "Ledet teamet – som besto av 12 utviklere fordelt på Oslo og Bergen, hvorav 4 var seniorer – gjennom transformasjonen."

Bedre: kutt innskuddet eller flytt til separat setning.

## Leselighets-metrikker

`checks/readability.ts` regner ut:

### Ord per setning

Splitt på `.`, `!`, `?`. Tell ord per segment.

### Subordinasjon-densitet

Tell forekomster av `som`, `at`, `hvis`, `når`, `der`, `mens`, `selv om`,
`fordi` per setning. Mer enn 2 per setning gir warning.

### Lange substantivfraser

Sammensatte ord på 4+ stavelser uten bindestrek flagges som info — kan ofte
forenkles.

## Severity

| Forhold | Severity |
|---|---|
| Bullet > 30 ord | important |
| Bullet > 25 ord | minor |
| Setning i sammendrag > 35 ord | important |
| Subordinasjon > 3 per setning | minor |
| Sammensatt ord > 4 stavelser | info |

## Eksempler

### For lang bullet

> "Var med på å bygge en ny salgsorganisasjon i Symantec Norge fra
> grunnen av i en periode da markedet var i sterk endring og selskapet
> trengte en helhetlig tilnærming for å lykkes mot lokale konkurrenter."

(38 ord, svak åpning, vag tidsindikasjon, tre leddsetninger.)

**Forbedret:**

> "Etablerte Symantec Norge fra null til markedsledende posisjon på fem år."

(11 ord, sterk åpning, konkret resultat.)

### Profilsammendrag-setning som er for lang

> "Senior teknologi- og kommersialiseringsleder med over 25 års erfaring fra
> enterprise IT, SaaS og PropTech, der jeg har bygget og restrukturert
> organisasjoner gjennom flere markedssykluser med konsistent fokus på
> bærekraftig vekst, kommersialisering av kompleks teknologi og
> kundesentriske operating models."

(40 ord, mange leddsetninger, klisjéer mot slutten.)

**Forbedret:**

> "Senior teknologi- og kommersialiseringsleder med 25 års erfaring fra
> enterprise IT, SaaS og PropTech. Har etablert og snudd virksomheter i
> flere markedssykluser, med konsistent fokus på vekst og operasjonell
> ekspertise."

(To setninger, 13 + 16 ord.)
