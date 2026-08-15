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

## Tidsgrense (statement_timeout)

`search_employers` og `count_employers` har begge `statement_timeout = 10s`.

Valget: tre ganger verste observerte kalde måling (`bygg`, 3,58 s), lavt nok til at en
spørring som løper løpsk stoppes som en tydelig databasefeil. Uten grense ville en
fremtidig regresjon henge til gatewayen kutter, og feilen ville se ut som nettverksfeil
i stedet for en treg spørring.

Kontrollmåling etter endringen (15. august, ende til ende over HTTP, ett kall per ord):
alle ti ordene fra del 1 ligger på 0,23–2,74 s for søk og 0,12–0,24 s for telling.
Ingen treffer 10-sekundersgrensen.

## Det som gjenstår

`bygg` er fortsatt det tregeste ordet: 3,58 s kaldt, over akseptansekravet på 500 ms
samlet responstid. Årsak:

- Speilet dekker kun rene navnesøk uten filtre. Søk med fylke, kommune, næring eller
  ansatteintervall går fortsatt mot `reg.enheter`.
- `bygg` har flest kandidater av de målte ordene, og hele kandidatmengden må rangeres
  før første side kan returneres.

Neste grep, hvis dette blir merkbart i bruk, er å **begrense kandidatmengden før
rangering** (for eksempel topp N per etasje før sortering), ikke å optimalisere videre
på indeks. Indeksene dekker allerede oppslaget; kostnaden ligger i mengden rader som
rangeres.

## Ansattefordeling: budsjett i spørringen, ikke i tidsgrensen

Tidsgrensen for et kall settes når det ytterste uttrykket starter. En funksjon
kan derfor ikke gi seg selv kortere frist underveis: `set_config('statement_timeout', ...)`
inne i `employer_ansatte_distribution` hadde ingen virkning, og tunge filtersøk
traff 10-sekundersgrensen og returnerte feil i stedet for tall.

Budsjettet ligger nå i selve spørringen:

- Rene navnesøk går mot søkespeilet `reg.enheter_sok` og telles i sin helhet opp til taket på 50 000.
- Søk med filtre går mot hele `reg.enheter`, og der telles høyst 3 000 treff. Nås
  grensen, svarer funksjonen `status: "utvalg"`, og banneret sier eksplisitt at
  tallene er et utvalg og at andelene kan avvike.
- Skulle beregningen likevel feile, svarer funksjonen `status: "utilgjengelig"`.
  Banneret viser da at fordelingen ikke kunne beregnes. Den skjuler seg aldri.

Målt etter endringen (kald og varm, sekunder):

| Søk | Kald | Varm | Status |
| --- | --- | --- | --- |
| bygg | 2,98 | 0,15 | ok (11 760 treff) |
| eiendom | 0,61 | 0,20 | ok (26 910) |
| holding | 0,33 | 0,22 | ok (49 335) |
| by | 0,14 | 0,12 | avvist, under tre tegn |
| bransje=bygg | 3,53 | – | utvalg (3 000) |
| bransje=helse | 2,04 | – | utvalg (3 000) |
| bransje=eiendom | 1,80 | – | utvalg (3 000) |
| bygg + bransje=bygg | 1,59 | – | utvalg (3 000) |

Fordelingstallene for rene navnesøk er uendret av grepet; de telles fortsatt
eksakt. Bare filtrerte søk regnes over et utvalg, og det fremgår i visningen.

## Regnskapshistorikk — dekningsgraden er tidsavhengig

Målt 15. august 2026: **1,64 %** av selskapene i `reg.regnskap` har mer enn ett
regnskapsår (6 456 av ~394 000 med regnskap).

Dette tallet er **ikke** en egenskap ved produktet og skal ikke brukes som fast
premiss. Speilet begynte å samle regnskap i juni 2026, og Regnskapsregisteret
leverer kun siste innsendte år per selskap. Historikk kan derfor bare akkumuleres
over tid: til sommeren 2027 vil de fleste selskapene ha to år, året etter tre.

Til sammenligning lå Suverra på rundt 1,4 % ved tilsvarende måling og ligger
høyere nå etter to ukers backfill.

**Skal måles på nytt om en måned** (rundt 15. september 2026). Andelen stiger
raskest akkurat nå, siden 2025-regnskapene kommer inn i denne perioden.

```sql
SELECT count(*) FILTER (WHERE n > 1)::numeric / count(*) * 100 AS andel_flere_aar
FROM (SELECT count(DISTINCT regnskapsaar) AS n FROM reg.regnskap GROUP BY organisasjonsnummer) t;
```

Historikkpanelet på arbeidsgiversiden (`RegnskapHistorikk.tsx`) er bygget for
dette: med færre enn to år viser det ingenting — ingen tom tabell og ingen
fotnote — og slår seg på av seg selv når det andre året kommer inn. Utvikling
beregnes bare innenfor samme regnskapstype, og hull i årsrekken merkes eksplisitt.
