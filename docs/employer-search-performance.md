# Arbeidsgiversøk — ytelse og kontrakt

## Speilet (`reg.enheter_sok`)

Smalt speil av `reg.enheter` med `organisasjonsnummer`, `navn`, `navn_norm`, `antall_ansatte`,
holdt synkront med radtriggere. Brukes når søket kun har fritekst/orgnr og ingen filtre.

### Hvorfor sidetall styrer, ikke disk alene

Selv når planen rapporterer `shared hit` koster første tilgang til en side 0,85–5 ms.
Kostnaden følger altså antall sider som må røres, ikke bare om de ligger på disk.
Derfor er speilet riktig uavhengig av cache-tilstand: det reduserer antall sider fra
10 000+ til ~4 000 for brede søk, og gevinsten holder både kaldt og varmt.

## Tellingen (`public.count_employers`)

- Tak: 50 000, eksakt telling under taket (0,12–0,48 s).
- Over taket returneres `capped: true` og `total_count = 50000`. Grensesnittet skriver
  «Over 50 000 treff». Ingen planestimat brukes: estimatet bommet med 84 prosent
  (49 650 mot faktisk 26 910), og et tall som later som det er talt er verre enn ingen tall.
- `is_estimate` er beholdt i svaret for bakoverkompatibilitet og er alltid `false`.

## Minste søkelengde

Tre tegn. Ingen enhetsnavn i registeret er kortere enn tre tegn (seks navn har nøyaktig tre).
Kortere søk gir tom liste med `reason: "min_query_length"`, ikke feil.

## Rangering

Etasjer (høyest først):

1. `5` — eksakt organisasjonsnummer
2. `4` — eksakt navn, eller eksakt normalisert navn (suffiks som AS/ASA fjernet)
3. `3` — navn starter med søkeordet
4. `2` — søkeordet som eget ord inne i navnet
5. `1` — øvrige delstrengtreff

Innenfor hver etasje: `antall_ansatte DESC NULLS LAST`, deretter `similarity`, deretter navn.
Similarity er tredje signal, ikke filter og ikke eneste rangering: den måler navnelengde og
straffer lange, gyldige navn.
