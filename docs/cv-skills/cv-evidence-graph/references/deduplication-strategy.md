# Dedupliseringsstrategi

Når brukeren importerer fra flere kilder (LinkedIn ZIP, gammel CV, manuell
innlegging), oppstår duplikater. Denne strategien beskriver når to atoms regnes
som samme fakta, og hvordan de slås sammen.

TypeScript-implementasjon i `scripts/deduplicate.ts`.

## Når kjøres deduplisering

| Scenario | Når |
|---|---|
| Etter LinkedIn ZIP-import | Før atoms skrives — sjekk mot eksisterende user-atoms |
| Etter LinkedIn PDF-parsing | Samme |
| Etter gammel CV-parsing | Samme |
| Etter manuell innlegging | Skip dedup automatisk; brukeren ser allerede eksisterende atoms |
| Ved review-steg | Brukeren kan slå sammen manuelt |

## Per-type matchingregler

### role

To roles regnes som samme hvis:
1. Normalisert `employer` matcher (case-insensitive, mellomrom og bindestrek-tolerant)
2. Normalisert `title` matcher
3. Tidsperiodene overlapper (overlapp uansett hvor lite teller som match)

Konfidens:
- `0.95` hvis nøyaktig samme `start_date`
- `0.80` hvis kun overlapp (ulik startdato)

Eksempler på match:
- "Cisco Systems Norge" + "COO" + 2019-01–2024-06 vs "Cisco Norge AS" + "COO" + 2019-03–2024-06 → match (overlapp + samme tittel)
- "Cisco" + "Country Manager" + 2015–2018 vs "Cisco" + "COO" + 2019–2024 → ingen match (ulik tittel, ingen overlapp)

### achievement

To achievements regnes som samme hvis:
1. Samme `parent_atom_id` (samme rolle)
2. Jaccard-similaritet på `structured_data.what` ≥ 0.7

Konfidens: lik Jaccard-verdien, kappet ved 0.9.

Begrunnelse: achievements omformuleres ofte mellom kilder (LinkedIn-tekst vs
gammel CV). Eksakt match er sjelden, men felles tokens fanger det meste.

### metric

Ingen automatisk dedup. Måltall er for spesifikke til at heuristikk gir mening.
Brukeren kan manuelt slå sammen i review-steget.

### education

To education-atoms regnes som samme hvis:
1. Normalisert `institution` matcher
2. Normalisert `degree` matcher

Konfidens:
- `0.95` hvis også `start_year` eller `end_year` matcher
- `0.85` ellers

### skill

To skill-atoms regnes som samme hvis:
1. Normalisert `name` matcher (case-insensitive)
2. Eller `name_normalized` matcher

Konfidens:
- `1.00` hvis identisk normalisert navn
- `0.95` hvis match på `name_normalized`

### language

To language-atoms regnes som samme hvis:
- Normalisert `language` matcher

Konfidens: `1.00`.

Hvis nivåer er ulike, behold høyeste nivå (native > fluent > professional >
conversational > basic).

### certification

To certifications regnes som samme hvis:
1. Normalisert `name` matcher
2. Normalisert `issuer` matcher

Konfidens: `0.95`.

### project

To projects regnes som samme hvis:
- Normalisert `name` matcher

Konfidens: `0.90`.

### context, tool, volunteer, summary_fragment

Ingen automatisk dedup. Disse er enten for kontekstuelle (context) eller for
varierte (volunteer, summary_fragment) til at heuristikk gir mening.

## Normalisering

For matching brukes denne normaliserings-funksjonen:

```typescript
function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[\s\-_./,]+/g, " ")
    .replace(/\s+/g, " ");
}
```

Eksempler:
- "Cisco Systems Norge" → "cisco systems norge"
- "Cisco-Systems_Norge" → "cisco systems norge"
- "MS Excel" → "ms excel"
- "M.S. Excel" → "m s excel"

For `employer_normalized`, `institution_normalized` og `name_normalized` bør
import-konvertere sette disse feltene proaktivt slik at matchingen blir billig.

## Merge-strategi

Når et duplikat finnes, slås atoms sammen ved hjelp av `mergeAtoms()`:

| Felt | Merge-regel |
|---|---|
| `content_no` | Behold lengste ikke-tomme |
| `content_en` | Behold lengste ikke-tomme |
| `structured_data` | Felt-vis: behold eksisterende verdi hvis ikke-tom; ellers ta inkommende |
| `structured_data` (arrays) | Slå sammen uten duplikater |
| `confidence` | Behold høyeste (verified > imported > inferred) |
| `source_ref` | Behold eksisterende; logg inkommende i source-historikken hvis trengs |

Merge skjer kun hvis brukeren ikke har låst atomet (`user_locked=false`).
Låste atoms behandles som immutable.

## Edge-tilfeller

### Samme arbeidsgiver, ulike titler

Hvis brukeren har hatt flere stillinger hos samme arbeidsgiver
(f.eks. "Cisco — Country Manager" og "Cisco — COO"), regnes de som
ulike role-atoms. Tidsperiodene må overlappe, og tittelen må matche, for
at de skal regnes som samme.

### Pågående rolle vs avsluttet rolle

Hvis inkommende har `is_current=true` og eksisterende har `end_date` satt,
men de ellers matcher (samme employer + title + overlappende perioder),
preferer inkommende `is_current`-flagget — brukeren har trolig oppdatert
i kilden.

### Konfidente konflikter

Hvis to atoms har motstridende `structured_data` (f.eks. ulik `start_date`),
kan ikke automatisk merge løse det. Slik atom-par returneres med
`confidence < 0.6` og overlates til manuell review.

## Hva som IKKE er duplisering

Disse er forskjellige atoms og skal ikke slås sammen:
- To roller med samme tittel hos samme selskap, men ikke-overlappende perioder
  (f.eks. "Manager" 2010–2012 og "Manager" 2018–2020)
- To skills med lignende men ikke identisk navn ("Sales Leadership" vs
  "Sales Management")
- En achievement under én rolle og en lignende achievement under en annen rolle
- Two language-atoms hvor språk er forskjellig selv om level er likt

## Logging

Hver merge-operasjon bør logges (i applikasjonslag, ikke i selve atomet)
slik at brukeren kan se i review-steget hva som ble slått sammen og fra
hvilke kilder.
