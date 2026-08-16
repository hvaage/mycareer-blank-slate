# Rydd opp i CV-gjennomgangen: fjern den frittstående AI-panelen

## Hva som faktisk skjer

På `/career/cv-review` vises AI-panelet «Analyser erfaringene dine» alltid øverst, uavhengig av hvor du er i den trinnvise gjennomgangen. Panelet får:

- **analysekandidater = kun funn du allerede har bekreftet.** Du har ingen bekreftede funn ennå, så listen er tom — derfor «Ingen funn å analysere i dette utvalget» straks du trykker «Start analyse».
- **«59 funn er ikke gjennomgått»** = hele den flate listen av ubehandlede parse-funn for importen. Det er samme datasett som trinnene deler opp, bare uten rolle- og tidsgruppering. Derfor kolliderer tallet med «19 til gjennomgang · 5 grupper» i trinn 2.

Panelet er altså et levning fra den flate køen, plassert foran den trinnvise flyten det skulle støtte.

## Forslag

1. **Fjern AI-panelet fra trinnene.** Under trinn 1–4 vises kun det aktive trinnet med sine egne tellere og grupper. Ingen parallell «start analyse»-knapp, ingen konkurrerende antall.
2. **Vis analysen først når den har noe å gjøre.** Panelet flyttes til etter siste trinn (eller den flate fanevisningen) og rendres kun når det finnes bekreftede funn å analysere. Uten bekreftede funn vises ingenting — brukeren skal ikke se en knapp som garantert feiler.
3. **Skjul tomme tilstander.** «Forslag klart for gjennomgang – ingen nye forslag akkurat nå» og «Rett opp funnene først» fjernes som frittstående blokker. Forslagsseksjonen vises bare når det finnes forslag; ellers ingen overskrift.
4. **Fjern rå-tellingen «59 funn».** Alt som telles for brukeren skal telles per trinn og per rolle, slik trinn 2 allerede gjør. Trenger panelet en advarsel, formuleres den som «X bekreftede resultater kan analyseres», ikke som en oppgaveliste.
5. **Feilmelding som ikke kan oppstå.** «Ingen funn å analysere i dette utvalget» blir uoppnåelig når knappen bare finnes med et ikke-tomt utvalg; teksten beholdes kun som teknisk fallback.

## Teknisk

- `src/routes/_authenticated/career/cv-review.tsx`: flytt `<CvAnalysisPanel>` ut av topp-plasseringen, render den kun i `else`-grenen (etter trinnene) og kun når `analysisCandidates.length > 0`.
- `src/components/cv/CvAnalysisPanel.tsx`: fjern `unresolvedCount`-varselet (og prop-en), skjul «Forslag klart for gjennomgang»-seksjonen når den er tom (`emptyText` bort), behold feil-/fremdriftsvisning uendret.
- Ingen endringer i backend, kontrakt, atomflyt eller analyse-API.
