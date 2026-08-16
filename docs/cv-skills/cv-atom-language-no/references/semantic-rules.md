# Semantiske regler for norsk CV-språk

## Sammensatte ord

Norsk komprimerer relasjoner i sammensatte ord. Identifiser kjernebegrepet og relasjonen, men behold originalordet som kilde.

| Kildeuttrykk | Mulig konsept | Ikke anta |
|---|---|---|
| ledelseskultur | leadership-culture | personalansvar eller resultat |
| salgsorganisasjon | sales-organization | at kandidaten bygget den |
| partnerstrategi | partner-strategy | antall partnere eller effekt |
| endringsledelse | change-leadership | formelt programansvar |
| forretningsutvikling | business-development | salg, inntekt eller P&L |
| kostnadsreduksjon | cost-reduction | beløp eller prosent |
| kompetansebygging | capability-building | kurs, teamstørrelse eller målt effekt |

Et sammensatt ord beskriver ofte objekt eller fagområde. Handlingen må finnes i verbet eller resten av setningen.

## Semantisk ekvivalens

Vurder uttrykk som ekvivalente bare når handling, objekt, aktør og omfang er kompatible.

| Uttrykk A | Uttrykk B | Standardvurdering |
|---|---|---|
| skapte ledelseskultur | skapte en kultur rundt ledelse | equivalent |
| bygget salgsorganisasjon | etablerte organisasjon for salg | equivalent |
| utviklet partnerstrategi | utformet strategi for partnere | equivalent |
| jobbet med ledelseskultur | skapte ledelseskultur | related, ikke equivalent |
| bidro til salgsvekst | doblet salget | distinct uten ytterligere belegg |
| ansvar for endringsledelse | gjennomførte transformasjonen | related, ikke equivalent |

## Nominaliseringer

- `etablering av kanalstrategi` kan foreslås som `etablerte kanalstrategi` bare dersom kandidaten er eksplisitt aktør.
- `ansvar for kommersialisering` betyr ansvar, ikke nødvendigvis at kommersialiseringen ble gjennomført eller lyktes.
- `gjennomføring av omorganisering` kan være handling eller ansvarsområde. Merk `needs_review` når subjektet er uklart.

## Eierskap og styrkegrad

Bevar styrkegraden:

`observerte < deltok i < bidro til < koordinerte < hadde ansvar for < drev < ledet/eide`

Ikke flytt et uttrykk oppover skalaen uten eksplisitt kildebelegg. Teamformuleringer som `vi leverte` skal ikke bli `jeg leverte` uten avklaring.

## Resultat versus aktivitet

- Aktivitet: `innførte CRM`, `ledet workshop`, `utviklet strategi`.
- Resultat: `reduserte salgssyklusen med 20 %`, `økte omsetningen`.
- Kontekst: `i en nordisk organisasjon`, `under fusjonen`.
- Metode: `ved å standardisere pipeline-styringen`.

Opprett ikke et resultatatom fra en aktivitet. Opprett ikke et måltall uten eksplisitt verdi og enhet.

## Negasjon og forbehold

Bevar ord som `ikke`, `omtrent`, `opptil`, `mer enn`, `mindre enn`, `planlagt`, `midlertidig`, `sammen med` og `foreslått`.

## Forkortelser og låneord

- P&L -> resultatansvar
- GTM -> go-to-market
- M&A -> fusjoner og oppkjøp
- SaaS, CRM, ERP, API, OKR og KPI beholdes

Ikke ekspander en ukjent forkortelse uten kontekst. Returner `uncertain`.

## Review-regler

Sett `needs_review=true` når subjekt eller eierskap er uklart, handlingen bare er implisert, en måling mangler referansepunkt, et uttrykk kan være både ansvar og prestasjon, mulige duplikater har ulikt omfang eller normaliseringen krever kunnskap som ikke står i kilden.
