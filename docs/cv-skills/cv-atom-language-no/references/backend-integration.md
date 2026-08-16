# Backend-integrasjon for Lovable og Claude

## Anbefalt flyt

1. Edge Function mottar dokument-id, kildesegmenter og språk.
2. Serveren verifiserer brukerens eierskap med eksisterende auth/RLS-mønster.
3. Serveren hasher kildeinnholdet og sjekker om samme kildeversjon allerede er behandlet.
4. Serveren sender kun nødvendige segmenter til Claude med `NORMALIZATION_SYSTEM_PROMPT_NO`.
5. Respons parses som `NormalizationBatch` og valideres med `validateNormalizationBatch()`.
6. Forslag lagres i eksisterende proposal/review-tabell med provenance og modellkjøringsmetadata.
7. Frontend lar brukeren godkjenne, avvise eller be om avklaring.
8. Bare godkjente forslag sendes til `cv-evidence-graph`.

## API-kontrakt

```json
{
  "sourceType": "old_cv_pdf",
  "sourceId": "uuid-eller-stabil-id",
  "sourceHash": "sha256",
  "language": "no",
  "segments": [
    { "id": "s-1", "text": "Skapte ledelseskultur i nordisk ledergruppe", "startOffset": 120, "endOffset": 171 }
  ]
}
```

Output er `NormalizationBatch` fra `scripts/types.ts`.

## Sikkerhetskrav

- Claude API-nøkkel lagres kun som Edge Function-secret.
- Logg modellkonfigurasjon, promptversjon, varighet og tokenbruk server-side; ikke vis leverandørnavn i produkt-UI.
- Ikke logg hele CV-teksten i vanlig driftslogg.
- Valider maksimal segmentlengde og antall segmenter før modellkall.
- Bruk tidsavbrudd og begrensede retries med backoff.
- Knytt alle forslag til `auth.uid()` og håndhev RLS på proposal-tabellene.

## Persistens

Gjenbruk faktiske tabellnavn i Karrierenmin.no etter inspeksjon. Dersom `atom_enrichment_proposals` finnes, bruk den. Ikke opprett en parallell proposal-modell.

Minimumsfelter per forslag er bruker, batch, status, full provenance, mål-entitet, payload, snapshot, diff, confidence, rationale, inferred-flagg og review-tidsstempler.

## Porter

Stopp før lagring når responsen har ugyldig schema, kildeutdraget ikke finnes i input, normalisert tekst introduserer tall/navn/datoer, eller forslaget mangler provenance.
