# Visuell omlegging av arbeidsgivervurdering

Målet er én tydelig vurderingsflate i samme ånd som Jobbi: andres vurderinger først og synlig, egen vurdering rett frem uten skjulte trinn.

## 1. Slidere alltid synlige — «Gi vurdering» fjernes

I dag må hver dimensjon «åpnes» med en knapp før slideren dukker opp. Det gjelder to steder: den gamle «Min vurdering»-boksen på selskapssiden og den nye felles vurderingsboksen.

Ny visning per dimensjon:

```text
Kultur og verdier                          Ikke vurdert
[ ●———————————————————————— ]   ← nøytral, ingen verdi valgt
                                 [Ikke nok grunnlag]
```

- Slideren vises alltid, i «uvurdert» tilstand (dempet spor, ingen thumb-verdi, teksten «Ikke vurdert» til høyre).
- Første berøring av slideren setter verdien; da blir sporet farget og teksten viser «4 / 5».
- «Gi vurdering»-knappen forsvinner helt. En liten «Ikke nok grunnlag»-lenke nullstiller dimensjonen igjen.
- Ingen forhåndsutfylte verdier — prinsippet om at ingenting påstås på brukerens vegne beholdes.

## 2. «Notat» → «Din vurdering av {Selskapsnavn}»

Fritekstfeltet får overskriften «Din vurdering av VEND AS» (selskapsnavnet settes inn dynamisk), med hjelpetekst om at teksten modereres før den eventuelt vises for andre. Samme navngivning brukes begge steder, slik at det ikke lenger ser ut som to ulike funksjoner.

## 3. Erfaringsgrunnlag som trykknapper

Nedtrekkslisten «Min vurdering — erfaringsgrunnlag» erstattes av en rad med valgbare «chips» gruppert etter relasjon:

```text
Din relasjon til selskapet
[Ansatt i dag] [Tidligere ansatt] [Innleid/konsulent]
[Har søkt jobb] [Vært til intervju]
[Kunde] [Samarbeidspartner] [Annet]
```

- Ett valg om gangen, valgt chip markeres med primærfarge.
- Under raden en linje som forklarer hva valget betyr for publisering (f.eks. at «Annet» lagres privat, og at søker-grunnlag kun vurderer rekrutteringsdimensjonen).
- Dimensjonslisten oppdateres umiddelbart etter valget, i stedet for å være skjult til man har valgt i en nedtrekksliste.

## 4. «Vurdering av arbeidsgiver» — vis andres vurderinger først

Kortet snus slik at innholdet fra andre kommer øverst og er det man ser uten å scrolle:

```text
┌──────────────────────────────────────────────┐
│ Vurdering av arbeidsgiver     3 vurderinger  │
│                                              │
│ Erfaring som ansatt            (2 bidrag)    │
│   Arbeidsmiljø        ███░░  3,0             │
│   Ledelse             ██░░░  2,0             │
│   Karriereutvikling   ████░  4,0             │
│                                              │
│ «Sitat fra godkjent fritekst …»              │
│   Tidligere ansatt · 2024                    │
│                                              │
│ Erfaringer fra søknadsprosessen  (låst)      │
│   Vises når fem bidragsytere har svart       │
└──────────────────────────────────────────────┘
      [ Gi din vurdering ]  → åpner skjemaet
```

- Antall vurderinger vises i kortoverskriften.
- Hver kohort får en visuell scorevisning (fem-trinns markører per dimensjon) i stedet for bare tall, slik at bildet leses raskt.
- Kohorter under terskelen vises som en tydelig «låst»-tilstand med forklaring, ikke som tom tekst.
- Godkjente fritekstsitater vises som korte kort under tallene.
- Egen vurdering ligger i en synlig, men sekundær seksjon under, åpnet av «Gi din vurdering» eller alltid utvidet hvis man allerede har vurdert (da med «Du har vurdert dette selskapet»-merke).

## 5. Rydde bort dobbeltoppsettet

Selskapssiden viser i dag to vurderingsbokser rett etter hverandre («Min vurdering» + «Vurdering av arbeidsgiver»), med to sett slidere og to lagre-knapper. Visuelt slås dette til ett kort, slik at brukeren møter én vurderingsflate. Den gamle boksens felter (søkt her / intervjuet her / jobbet her) dekkes av relasjons-chipsene i punkt 3.

## Teknisk omfang

- `src/components/employers/EmployerCommonReview.tsx`: chips for grunnlag, alltid synlige slidere, omskrevet aggregatvisning med scoremarkører og låst-tilstand, ny fritekstoverskrift med selskapsnavn (nytt `companyName`-prop).
- `src/routes/_authenticated/employers/$companyId.tsx`: fjerne/slå sammen den gamle «Min vurdering»-boksen, sende selskapsnavn videre.
- `src/routes/_authenticated/vurdering-av-arbeidsgivere/index.tsx`: søkeresultat viser antall vurderinger tydeligere.
- Ingen endringer i databasen, RPC-ene eller personverntersklene i denne omgangen — kun presentasjon.
