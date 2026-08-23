# Arbeidsgiveranalyse fra Muligheter må velge riktig selskap først

## Problemet

I dag starter knappen «Start arbeidsgiveranalyse» i boksen «Arbeidsgiverinnsikt» på
mulighetssiden analysen umiddelbart. Når muligheten ikke er koblet til et
organisasjonsnummer, sendes bare selskapsnavnet inn, analysen feiler, og brukeren
sitter igjen med «Mangler organisasjonsnummer på selskapet — kan ikke vise
arbeidsgiveranalyse.»

Under Marked → Arbeidsgivere gjøres dette riktig: «Finn ny arbeidsgiver» åpner en
søkedialog mot arbeidsgiverregisteret, brukeren velger og bekrefter juridisk enhet,
og analysen startes med et validert organisasjonsnummer.

## Hva som bygges

Samme kontrollerte flyt i «Arbeidsgiverinnsikt» på mulighetssiden:

1. Når selskapet mangler organisasjonsnummer, åpner «Start arbeidsgiveranalyse» den
   eksisterende søkedialogen i stedet for å starte noe.
2. Dialogen forhåndsutfylles med navnet på selskapet muligheten er knyttet til, og
   søket kjøres automatisk på dette navnet. Brukeren ser treffene og kan endre søket
   fritt (navn eller organisasjonsnummer).
3. Brukeren velger selskap, ser bekreftelsessteget med juridisk navn, orgnr, sted,
   bransje, ansatte og risiko-/datakvalitetsmerker, og huker av for at det er riktig
   arbeidsgiver.
4. Først da startes analysen — med validert nisifret organisasjonsnummer, nøyaktig
   som i Marked-flyten.
5. Etter start: samme tilbakemelding som i dag (analysen kjører i bakgrunnen, panelet
   oppdateres), og panelet leser videre på det valgte organisasjonsnummeret.

Når selskapet allerede har et gyldig organisasjonsnummer, endres ingenting: knappen
starter (eller oppdaterer) analysen direkte som før.

## Teknisk

- Gjenbruk `src/components/employers/EmployerAnalysisSearchDialog.tsx` uendret. Den
  utvides kun med en valgfri `initialQuery`-prop som setter startsøket; standardadferd
  er identisk for Marked-siden.
- `StartAnalysisButton` i `src/components/network/company-insight-panels.tsx` deles i
  to tilstander: har orgnr → direkte start; mangler orgnr → åpner dialogen med
  mulighetens selskapsnavn som startsøk.
- Analysen kalles fortsatt via `analyze-company` med `{ user_id, organisasjonsnummer }`
  og samme validering (`/^[0-9]{9}$/`) og feilhåndtering som i Marked-flyten.
- Etter bekreftet valg oppdateres panelvisningen til det valgte orgnr-et, og
  `employer-analysis-view` invalidieres slik at resultatet vises når analysen er klar.
- `existingByOrgnr` fylles fra brukerens eksisterende arbeidsgivere slik at «Allerede
  lagt til» og «Åpne arbeidsgiver» virker likt her.
- Ingen databaseendringer, ingen endring i analysebackend, ingen automatisk start.
