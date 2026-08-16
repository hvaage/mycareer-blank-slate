# Sterke åpningsverb for CV-bullets

Tabell over verb som signaliserer eierskap og handling, organisert etter
domene. Brukes av `checks/verb-strength.ts` til å foreslå alternativer
for svake åpninger.

## Svake åpninger som flagges

| Svak åpning | Hvorfor svak |
|---|---|
| `Var ansvarlig for…` | Generisk — kan bety alt fra "tok kaffe" til "drev avdelingen". Bruk konkret verb. |
| `Hjalp til med…` | Devalverer rollen — signaliserer assistanse, ikke eierskap. |
| `Bidro til…` | Vag — leser tenker "hvor mye?". Bruk konkret verb. |
| `Var involvert i…` | Helt tomt — sier ingenting om rollen. |
| `Var del av…` | Samme som over — passiv plassering, ikke handling. |
| `Jobbet med…` | For generelt — alle "jobber med" noe. |
| `Hadde ansvar for…` | Tvetydig — kan være OK i konkrete tilfeller, men oftere kan byttes til konkret verb. |
| `Var med på å…` | Devalverende — signaliserer assistent-rolle. |
| `Tok del i…` | Passiv — bytt til konkret handling. |
| `Spilte en rolle i…` | Oversettelse av "played a role in" — generisk. |

## Sterke alternativer per domene

### Ledelse og strategi

- `Ledet`, `Drev`, `Eide`, `Etablerte`, `Bygde`, `Restrukturerte`, `Transformerte`,
  `Snudde`, `Omstilte`, `Definerte`, `Lanserte`, `Anførte`, `Iverksatte`

Eksempler på bruk:
- `Ledet fusjonsprosessen mellom A og B til avsluttet integrasjon på 18 måneder.`
- `Snudde omsetningstap på 15 % YoY til 12 % vekst på to kvartaler.`
- `Etablerte ny operating model for Norden med fem datterselskaper.`

### Salg og forretningsutvikling

- `Vant`, `Lukket`, `Sikret`, `Forhandlet`, `Doblet`, `Tredoblet`, `Bygde`,
  `Utvidet`, `Lanserte`, `Etablerte`

Eksempler:
- `Vant to enterprise-kontrakter med samlet TCV på USD 12 mill.`
- `Doblet pipeline-coverage på fire måneder gjennom restrukturering av outbound-teamet.`

### Produkt og leveranse

- `Lanserte`, `Leverte`, `Bygde`, `Definerte`, `Designet`, `Implementerte`,
  `Integrerte`, `Migrerte`, `Skalerte`

Eksempler:
- `Lanserte ny SaaS-plattform med 800+ kunder i pilotbasen.`
- `Migrerte hovedproduktet fra monolith til microservices uten merkbar nedetid.`

### Operasjoner og effektivisering

- `Optimerte`, `Effektiviserte`, `Automatiserte`, `Standardiserte`, `Strømlinjeformet`,
  `Reduserte`, `Forenklet`, `Konsoliderte`

Eksempler:
- `Reduserte time-to-market fra 6 til 2 uker gjennom CI/CD-implementering.`
- `Automatiserte månedlig rapportering og kuttet 40 timer manuelt arbeid per syklus.`

### Endring og transformasjon

- `Drev`, `Gjennomførte`, `Omstilte`, `Restrukturerte`, `Implementerte`,
  `Iverksatte`, `Innførte`

Eksempler:
- `Drev innføring av MEDDPICC i et team på 20 selgere over 6 måneder.`
- `Implementerte ny målstyring (OKR) på selskapsnivå.`

### Samarbeid og påvirkning

- `Samarbeidet med`, `Koordinerte`, `Forhandlet`, `Influerte`, `Avstemte`

Merknad: disse er svakere enn ledelsesverbene over. Bruk når kandidaten
faktisk var likestilt med andre, ikke som unnvikelse fra `ledet`/`drev`.

## Engelske ekvivalenter

For engelske CV-er:

| Norsk | Engelsk |
|---|---|
| Etablerte | Established, Founded, Built, Set up |
| Ledet | Led, Drove, Directed, Headed |
| Bygde | Built, Grew, Scaled |
| Vant | Won, Secured, Closed |
| Doblet | Doubled, 2x'd |
| Lanserte | Launched, Released, Shipped |
| Snudde | Turned around, Revived |
| Reduserte | Reduced, Cut, Slashed |
| Automatiserte | Automated, Streamlined |
| Drev | Drove, Spearheaded, Owned |

### Engelske svake åpninger

| Svak | Sterk |
|---|---|
| `Was responsible for…` | `Led`, `Owned`, `Drove` |
| `Helped to…` | (vurder å fjerne) |
| `Assisted with…` | (vurder å fjerne) |
| `Worked on…` | (konkret verb) |
| `Was part of…` | (konkret verb) |
| `Contributed to…` | (konkret verb) |

## Kontekstuelle unntak

Noen ganger er svake åpninger akseptable:

- **`Bidro til`**: når atomet faktisk har `is_team_achievement: true` — da er det riktig å ikke promotere bidraget til full ledelse.
- **`Var del av`**: i ledergruppe-kontekst (`Var del av ledergruppen for Norden`) — beskriver organisatorisk rolle, ikke handling.
- **`Hadde ansvar for`**: i kombinasjon med konkret omfang (`Hadde ansvar for et budsjett på NOK 100 mill.`) — flagges som warning, ikke critical.

`checks/verb-strength.ts` skal være konservativ — flagge svakheten men la
brukeren overstyre når det er kontekstuelt riktig.

## Verb i preteritum vs presens

For preteritum (tidligere roller), legg til `-te`/`-de`/`-et`-suffiks:

| Infinitiv | Preteritum |
|---|---|
| å lede | ledet |
| å bygge | bygde |
| å drive | drev |
| å etablere | etablerte |
| å lansere | lanserte |
| å vinne | vant |
| å lukke | lukket |
| å transformere | transformerte |

For presens (nåværende rolle):

| Infinitiv | Presens |
|---|---|
| å lede | leder |
| å drive | driver |
| å eie | eier |
| å ansvarliggjøre | har ansvaret for |

Sjekk-modulen `tense-consistency.ts` flagger blanding av tider innen samme
rolle.
