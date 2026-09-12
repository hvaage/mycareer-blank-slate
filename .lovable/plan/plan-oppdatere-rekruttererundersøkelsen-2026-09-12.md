# Plan: oppdatere Rekruttererundersøkelsen

## Mål

Oppdatere den aktive rekruttererundersøkelsen slik at sektor kan velges som flervalg, «Annet» åpner et eget tekstfelt på de angitte spørsmålene, AI-spørsmålet blir flervalg, og hvert nytt spørsmål vises fra samme startposisjon.

## Skjema og svar

- Endre «Primær sektor» til flervalg og lagre flere sektorer per respondent, samtidig som eksisterende enkeltsvar fortsatt kan leses i resultater og eksport.
- Vis et tekstfelt når «Annet» velges på disse spørsmålene:
  - vanligste årsak til at kandidaten ikke går videre
  - kandidater som kontaktes direkte
  - informasjon som savnes
  - årsak til at kandidaten takker nei
  - AI-verktøy/automatiserte løsninger
  - vanlige kandidatfeil
  - hvordan AI har endret vurderingen
  - fremtidige kandidatferdigheter
- Lagre utdypingen sammen med det aktuelle svaret, og krev innhold i feltet når «Annet» er valgt.
- Endre «Hvordan har AI endret hva du ser etter hos kandidater?» til flervalg og legg til «AI har gjort søknadsbrev mindre interessant».
- Legg til «Annet» på spørsmålet om ferdigheter de neste 12–24 månedene.
- Skriv om alle svarene under «Hvilket utsagn stemmer best?» til selvstendige, fullstendige utsagn.

## Visning

- Når respondenten går videre eller tilbake, rulles det aktive spørsmålet til samme startposisjon i visningen.
- Lange alternativlister vises i to kolonner på skjermer med nok plass, men én kolonne på små skjermer.
- Behold eksisterende anonymitet, progresjon, validering og resultatpåmelding.

## Dataendring

- Lag en liten additiv migrasjon for flervalg av sektor og oppdatering av spørsmålene i den aktive undersøkelsesversjonen.
- Bevar historiske svar og dagens resultat-/eksportkontrakter.
- Oppdater genererte typer bare dersom den nye kolonnen krever det.

## Verifisering

- Test flervalg av sektor, «Annet»-felt for enkelt- og flervalg, obligatorisk utdyping, AI-flervalg og innsending.
- Kontroller at neste/tilbake plasserer spørsmålet øverst, og at alternativene fordeles korrekt på mobil og stor skjerm.
- Kjør relevante tester, typekontroll, lint og bygg.
- Ikke publiser.
