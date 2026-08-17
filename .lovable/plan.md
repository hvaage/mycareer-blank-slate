# Én sammenhengende flyt: opplasting → analyse → trinn 1–4

## Problemet

I dag er CV-import tre manuelle trinn før gjennomgangen i det hele tatt starter:

1. Last opp fil
2. Trykk «Analyser CV»
3. Gå gjennom en flat avhukingsliste («Vi fant 43 elementer …», skjermbildet du sendte) og trykk «Bekreft og lagre»

Denne flate listen gjør samme jobb som trinn 1–4 gjør bedre — og den lar deg ikke definere roller, som er hele poenget med trinn 1.

## Slik skal det bli

```text
Velg/slipp fil  →  Laster opp …  →  Analyserer …  →  Trinn 1 av 4: Roller
                   (automatisk)      (automatisk)      (gjennomgangen)
```

- Analysen starter av seg selv så snart opplastingen er bekreftet fullført. Ingen «Analyser CV»-knapp i normalflyten.
- Den flate avhukingslisten fjernes fra normalflyten. Ingenting «bekreftes» der lenger — bekreftelsen skjer i trinn 1–4.
- Når analysen er ferdig vises en kort kvittering med hva som ble funnet («Vi fant X roller, Y resultater, Z kompetanser») og to valg: **Gå gjennom nå** (til trinn 1) eller **Senere**. Dette er allerede bygget og beholdes.
- Velger du «Gå gjennom nå» lander du i trinn 1 av 4 — karrieretidslinjen — der roller defineres, rettes, slås sammen og suppleres (Privat/Freelance osv.), akkurat som vi bygget.
- Gjenopptak: kommer du tilbake til en import som allerede er analysert, sendes du rett til gjennomgangen i stedet for tilbake til opplastingsskjermen.
- Feiler analysen, vises feilmelding med «Prøv analysen på nytt» — den manuelle startknappen finnes altså fortsatt, men bare som gjenoppretting.
- «Avbryt» beholdes i alle mellomtilstandene.

## Teknisk

Endringer i `src/components/cv-upload/cv-upload-flow.tsx`:

- Etter `upload_done` (både filopplasting og valg fra CV-arkivet) kalles `runAnalyze` automatisk.
- `await_parse`-tilstanden vises bare når analysen har feilet (gjenoppretting), ikke som ordinært mellomsteg.
- `parsed_preview` med `PreviewSummary`/`PreviewDetails`/avhuking fjernes fra normalflyten; etter vellykket analyse går flyten rett til commit av hele det analyserte settet og deretter til `done`-kvitteringen. `selected`-tilstand, `filterParsedData`-skrivingen og de tilhørende hjelpefunksjonene ryddes bort der de ikke lenger brukes.
- `discovered`-tellingene settes fra `countsFromParsed(raw)` slik at kvitteringsteksten fortsatt stemmer.
- Gjenopptakslogikken (`useResumableImport`) peker mot `/career/cv-review?import=…` når importen allerede har lesbare parse-data.

Ingen backend-endringer: samme `register` → `runParse` → `commit`-kjede, samme grenser for v2.1-jobbveien, og gjennomgangen i trinn 1–4 er uendret.
