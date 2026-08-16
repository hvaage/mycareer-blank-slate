# Lovable/Claude-backend for ATS

## To separate resultater

Backend skal aldri kollapse disse til én score:

1. `AtsCheckResult`: teknisk lesbarhet, struktur, språkformat og personvern.
2. `AtsRelevanceResult`: dekning av krav og nøkkelord som faktisk støttes av bekreftede atoms.

En teknisk ATS-trygg CV kan ha lav relevans. Høy relevans gir aldri lov til å legge til erfaring kandidaten ikke har.

## Datakilder

- CV-utkast med atom-id per tekstblokk.
- Bekreftede bruker-atoms som `CandidateEvidenceTerm[]`.
- Krav-atoms fra den aktuelle jobbannonsen som `TargetKeyword[]`.

Kun `user_confirmed=true` teller som støtte i den deterministiske dekningen. Importerte eller inferred atoms kan vises som review-forslag, men kan ikke brukes for å sette inn et nøkkelord i CV-en.

## Edge Function

Anbefalt funksjon: `evaluate-cv-ats`.

1. Verifiser bruker og dokumenteierskap.
2. Hent dokumentets atom-snapshot og jobbens krav-atoms.
3. Kjør `validateCvDraft()`.
4. Kjør `evaluateKeywordCoverage()`.
5. Returner begge resultater med `rules_version`.
6. Lagre resultatet på dokumentversjonen før eksport.

Claude kan foreslå naturlig plassering av et støttet nøkkelord. Forslaget må deretter gjennom `cv-hallucination-guard`. Claude skal ikke avgjøre om kandidaten har kompetansen.

## Porter

- Blokker eksport ved ATS `error`.
- Blokker aldri bare fordi et jobbkrav er unsupported; vis gapet ærlig.
- Blokker innsetting av nøkkelord uten minst én bekreftet `supporting_atom_id`.
- Bevar atom-id i dokumentets snapshot og rendermetadata.
