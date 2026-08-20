# LinkedIn-import: stillinger, kurs og kompetanse kommer aldri frem — årsak og løsning

## Svaret på spørsmålet ditt

Nei, stillinger og kompetanser fra LinkedIn er **ikke** lagret på deg, og de ble **ikke** vist i gjennomgangen. De er lest inn og ligger i mellomlageret — 12 stillinger, 95 kompetanser, 5 sertifiseringer, 1 utdanning, 2 frivillige verv og 1 språk — men de ble aldri gjort om til forslag.

Årsaken er bekreftet i dataene: avstemmingen for «karriere» rapporterte «0 kilderader» og «0 forslag» selv om 468 rader var koblet til importen. Uttrekket av kilderadene gjøres i én enkelt spørring med hele id-listen, og den spørringen faller stille igjennom når listen blir stor. Jobbsignaler (301 rader) gikk gjennom, karriere (468) og nettverk (2017) gjorde det ikke — og kjøringen ble likevel markert som «vellykket». Derfor så du bare profilfelter og 300 jobbsignaler.

Kurs er en egen sak: `Learning.csv` ble funnet i eksporten, men formålet «kurs/læring» ble aldri tilbudt i formålsvalget, så filen ble aldri lest inn.

## Det som skal fikses

### 1. Karriereavstemmingen må faktisk kjøre
- Uttrekket av kilderader deles i bolker, slik at antall rader ikke lenger avgjør om noe blir lest.
- En kjøring som ikke fikk lest kildene skal aldri kunne rapportere «vellykket» — den feiler synlig, med årsak, og kan kjøres på nytt fra importsiden.
- Karriereavstemming kjøres på nytt for importen din, slik at de 116 karriererader (stillinger, kompetanse, sertifiseringer, utdanning, språk, frivillig) blir til forslag.

### 2. Kurs blir en del av importen
- «Kurs og læring» legges til som valgbart formål ved import, slik at `Learning.csv` leses inn og avstemmes mot kvalifikasjonene dine.

### 3. Stillinger vises kompakt, som i Trinn 1 ved CV-import
- Egen seksjon «Stillinger fra LinkedIn» i kildegjennomgangen, med samme kompakte tidslinjeoppsett som CV-importens Trinn 1: én linje per stilling med tittel, arbeidsgiver og periode.
- Hver stilling avstemmes mot rollene i «Erfaring og kompetanse»:
  - **Finnes allerede** — samme rolle gjenkjent; vises som bekreftet uten å kreve handling, med mulighet til å fylle inn manglende dato eller beskrivelse.
  - **Avvik** — samme rolle, men ulik periode/tittel/arbeidsgiver; vises side ved side med valget «behold mitt» / «bruk LinkedIn» / «rett manuelt».
  - **Ny rolle** — legges til i «Erfaring og kompetanse» ved godkjenning, med LinkedIn som sporet kilde.
- Massehandling: «Godkjenn alle nye roller» og avkryssing for delvis godkjenning. Avvik må alltid besluttes enkeltvis.
- Har man ikke gjort CV-import, blir dette den naturlige starten: rollene opprettes her, og en senere CV-import avstemmes mot dem i stedet for å duplisere. LinkedIn-først blir dermed en fullverdig vei inn.

### 4. Kompetanse (Skills) behandles som kompetanse, ikke som løse rader
- 95 kompetanser skal ikke bli 95 kort. De vises som én gruppe med avkryssing, delt i «finnes allerede hos deg» og «ny».
- Kompetanse fra LinkedIn er ubelagt påstand. Ved godkjenning legges den inn som kompetanse med LinkedIn som kilde og uten belegg, og den merkes tydelig som «mangler belegg» slik at den kan kobles til rolle eller resultat senere — på samme måte som i CV-flyten.
- Sertifiseringer, utdanning, språk og frivillig arbeid vises som egne små grupper med samme kompakte oppsett.

### 5. Fortsatt gjeldende fra forrige plan
- Jobbsignaler importeres ikke i det hele tatt, og eksisterende 299 rader tas ut av køen.
- Forslag som ikke kan endre noe opprettes aldri og vises aldri.
- Klikk gir umiddelbar respons, angremulighet og «Behandlet»-seksjon.
- «Sikkerhet 50 %» erstattes med forklarende tekst.
- Norsk er løsningens språk; engelsk kun ved eksplisitt generering.

## Teknisk gjennomføring

- `src/lib/linkedin/reconciliation/engine.server.ts`: bolkevis henting av staging-rader (`.in(...)` i porsjoner), feil fra kildeuttrekket propageres til kjøringsstatus i stedet for å bli svelget, og kjøring med null leste rader mot ikke-tom koblingsliste behandles som feil.
- Formålsvalget ved import utvides med «learning», og klassifiseringen for `Learning.csv` kobles på.
- Stillingsforslag får eget visningsspor i `kildegjennomgang.tsx`, som gjenbruker den kompakte tidslinjekomponenten fra CV-gjennomgangens Trinn 1.
- Promotering av stillinger og kompetanse går gjennom eksisterende promoteringslag mot `career_atoms`, med kildesporing; ingen ny modell.
- Karriere- og nettverksavstemmingen for eksisterende import kjøres på nytt etter rettelsen; ingen data slettes.

## Rekkefølge

1. Rett karriereavstemmingen og kjør den på nytt (uten dette er alt annet usynlig).
2. Kompakt stillingsgjennomgang mot «Erfaring og kompetanse».
3. Kompetanse, sertifisering, utdanning, språk og frivillig som grupper.
4. Kurs som nytt formål.
5. Øvrige punkter fra forrige plan (støyfjerning, respons på klikk, sikkerhetstekst).
