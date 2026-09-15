# PDF-eksport av arbeidsgiveranalysen

Legg en «Last ned PDF»-knapp på selskapssiden `/arbeidsgivere/<orgnr>` som lager
en ferdig formatert rapport av arbeidsgiveranalysen. Knappen bruker analysen som
allerede ligger lagret, så alle tidligere genererte analyser kan eksporteres med
en gang — ingenting må analyseres på nytt.

## Hva brukeren får

- Knapp øverst i analysedelen: «Last ned analysen som PDF». Den vises bare når
  selskapet faktisk har en analyse.
- Filnavn: `arbeidsgiveranalyse-<selskapsnavn>-<orgnr>.pdf`.
- Forside med stor Karrierenmin-logo, selskapsnavn, organisasjonsnummer,
  bransje/sted, dato for når analysen sist ble oppdatert, og dato for
  nedlastingen.
- Innholdssider med liten logo i topptekst og sidetall «Side X av Y» i bunnteksten.
- Rapporten følger samme rekkefølge som på skjermen: hovedfunn, dimensjonsscore
  (åtte dimensjoner med tallscore og søylegrafikk), finansiell oversikt,
  detaljert gjennomgang av dimensjonene, ESG, omtaletrend, lønnssignaler,
  AI-modenhet, helhetsvurdering, kilder, ansvarsfraskrivelse og metode.
- Uinnlogget eksport inneholder aldri kandidatmatch, personlig vekting,
  scenarienotater eller «Min vurdering». Innlogget eksport bruker nøyaktig samme
  offentlige innhold i denne leveransen, så en delt PDF aldri kan lekke
  personlige data.

## Visuell kvalitet

- Tekst brytes og plasseres linje for linje, slik at siden aldri avsluttes med
  en overskrift uten innhold under seg, og aldri med én enkelt avsnittslinje
  (ingen «orfane» linjer). Minst to linjer følger etter en overskrift, ellers
  flyttes hele blokken til neste side.
- Score-blokker, tabellrader og kildeoppføringer flyttes hele til neste side
  framfor å bli delt.
- Faste marger, norsk tallformat, og «Ikke nok data» der score mangler
  (aldri 0).

## Teknisk

- Ny modul `src/lib/employers/analysis-pdf.ts`: bygger PDF-en med `jspdf`
  (ny avhengighet) direkte fra `EmployerAnalysisViewEnvelope` — ikke skjermbilde
  av siden, slik at typografi og sideskift kan styres presist.
- Delt layoutmotor i samme modul: en kursor holder styr på y-posisjon,
  `ensureSpace(nødvendigHøyde)` starter ny side, og `heading()` reserverer plass
  til overskrift + to linjer før den skrives.
- Etikett- og formateringslogikk (dimensjonsnavn, evidensstatus, finanskilder,
  tallformat) hentes ut av `EmployerAnalysisReportV2.tsx` til en delt
  `analysis-labels.ts`, slik at skjerm og PDF viser identiske tekster.
- Logo: `src/assets/karrierenmin-lockup.svg` rasteriseres i nettleseren til
  PNG via canvas ved eksport og legges inn på forside (stor) og som topptekst
  (liten). Faller tilbake til ren tekstlogo hvis rasteriseringen feiler.
- Eksporten kjører kun i nettleseren (dynamisk import i klikkhåndtereren), så
  serverrendering og byggetid påvirkes ikke.
- Ny knappekomponent `src/components/employers/AnalysisPdfButton.tsx` med
  lastestatus og feilmelding via toast.
- Ingen endringer i database, RPC-er, edge functions eller analyselogikk.

## Verifisering

- Enhetstester for sideskift-reglene (ingen overskrift alene nederst, ingen
  enkeltstående sluttlinje) og for at offentlig eksport ikke inneholder
  kandidatmatch-felt.
- Manuell kontroll: generer PDF for et selskap med ferdig analyse, konverter
  hver side til bilde og se gjennom alle sidene for avkuttet tekst, overlapp,
  tomme sider og feil rekkefølge før leveranse.
- Typecheck, lint og bygg.
