# Valideringsregler

Denne filen samler alle valideringsregler for atoms i ett oversiktlig sted.
TypeScript-implementasjonen ligger i `scripts/validators.ts`.

## Felles regler (alle atom-typer)

| Regel | Krav |
|---|---|
| `user_id` | Påkrevd, ikke-tom string |
| `atom_type` | Påkrevd, må være en av de definerte typene |
| Innhold | Minst én av `content_no`, `content_en` eller meningsfullt `structured_data` må være satt |
| `content_no` lengde | Maks 2000 tegn |
| `content_en` lengde | Maks 2000 tegn |

## Hierarki-regler

| Atom-type | Hierarki-krav |
|---|---|
| `achievement` | Krever `parent_atom_id` (peker til role) |
| `metric` | Krever `parent_atom_id` (peker til achievement) |
| `language` | Skal IKKE ha `parent_atom_id` |
| `summary_fragment` | Skal IKKE ha `parent_atom_id` |
| `role` | Skal ikke ha `parent_atom_id` |
| `education` | Skal ikke ha `parent_atom_id` |
| `skill` | Skal ikke ha `parent_atom_id` |
| `certification` | Skal ikke ha `parent_atom_id` |
| `volunteer` | Skal ikke ha `parent_atom_id` |
| `context` | Krever `parent_atom_id` (peker til role) |
| `tool` | Kan ha `parent_atom_id` (role) eller stå alene |
| `project` | Kan ha `parent_atom_id` (role) eller stå alene |

## Per-type krav

### role

| Felt | Krav |
|---|---|
| `employer` | Påkrevd, ikke-tom |
| `title` | Påkrevd, ikke-tom |
| `start_date` | Påkrevd, format `YYYY-MM` |
| `end_date` | Hvis satt, format `YYYY-MM` og `≥ start_date` |
| `start_date` ≤ dagens dato | Påkrevd |
| `is_current=true` impliserer `end_date=null` | Advarsel hvis brutt |

### achievement

| Felt | Krav |
|---|---|
| `parent_atom_id` | Påkrevd (peker til role) |
| `what` | Påkrevd, ikke-tom |
| Enten XYZ-trippel eller CAR-trippel | Advarsel hvis ingen av dem |
| `scope_team_size` | Hvis satt, må være `≥ 0` |

### metric

| Felt | Krav |
|---|---|
| `parent_atom_id` | Påkrevd (peker til achievement) |
| `value` | Påkrevd, finite number |
| `unit` | Påkrevd, ikke-tom |
| `metric_type` | Påkrevd |

### education

| Felt | Krav |
|---|---|
| `institution` | Påkrevd |
| `degree` | Påkrevd |
| `start_year` | Påkrevd, firesifret YYYY, maks `currentYear+1` |
| `end_year` | Hvis satt, må være `≥ start_year` |

### skill

| Felt | Krav |
|---|---|
| `name` | Påkrevd |
| `category` | Påkrevd |
| `years_used` | Hvis satt, må være `≥ 0` |

### language

| Felt | Krav |
|---|---|
| `language` | Påkrevd |
| `level` | Påkrevd, må være: `native`, `fluent`, `professional`, `conversational`, `basic` |

### certification

| Felt | Krav |
|---|---|
| `name` | Påkrevd |
| `issuer` | Påkrevd |
| `issued_date` | Hvis satt, format `YYYY-MM` |
| `expires_date` | Hvis satt, format `YYYY-MM` |

### project

| Felt | Krav |
|---|---|
| `name` | Påkrevd |
| `description` | Påkrevd |
| `start_date` / `end_date` | Hvis satt, format `YYYY-MM` |

### volunteer

| Felt | Krav |
|---|---|
| `organization` | Påkrevd |
| `role` | Påkrevd |
| `start_date` | Påkrevd, format `YYYY-MM` |
| `end_date` | Hvis satt, format `YYYY-MM` |

### context, tool, summary_fragment

`structured_data` må være satt og ikke tom.

## Datoformat

- Måned-presisjon: `YYYY-MM`
- Bare år (kun `education.start_year` og `end_year`): firesifret number

Sammenligning av `YYYY-MM`-strenger fungerer leksikografisk
(`"2023-01" < "2023-02"`), så ingen Date-objekter trengs for ordering.

## Confidence-regler

Validering setter ikke `confidence` automatisk. Caller må sette riktig
`confidence`-verdi basert på kilde:

| Kilde | Default confidence |
|---|---|
| Manuell innlegging i CV-builder | `verified` |
| Intervju-engine etter brukerbekreftelse | `verified` |
| About-me-profil (felter brukeren selv har skrevet) | `verified` (hvis brukeren har bekreftet i review) |
| LinkedIn ZIP/PDF, gammel CV — direkte etter import | `imported` |
| AI-utfylling av manglende felt | `inferred` |

`inferred` atoms må aldri brukes i CV-rendering før brukeren har bekreftet.
Dette håndheves ikke av validatoren — det er kompositorens ansvar.

## Hva validatoren ikke fanger

- Faktisk eierskap av påstander (om brukeren faktisk var COO)
- Innholdsmessig konsistens mellom atoms (f.eks. én role som overlapper i tid med en annen ved samme arbeidsgiver)
- Tegnsetting og språkstil i `content_no`/`content_en`
- Relevans av achievements til rolle de er knyttet til

Disse sjekkene gjøres av andre Skills (`cv-quality-no`,
`cv-hallucination-guard`) eller manuell review.
