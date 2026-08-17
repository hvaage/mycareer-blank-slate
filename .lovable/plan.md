# Opplasting → automatisk analyse → Trinn 1–4 (ingen flat forhåndsgodkjenning)

## Ny normalflyt

```text
Velg fil → Laster opp → Registrerer import → Materialiserer parsekandidater
        → v2.1-atomiseringsjobb med fremdrift per rolleblokk
        → «Analysen er ferdig …»  →  [Gå gjennom nå] / [Senere]
        → /career/cv-review?import=<id>  →  Trinn 1 av 4
```

Den flate listen («Vi fant 43 elementer», Velg alle / Fjern alle / Bekreft og lagre) fjernes som brukerflate. Den finnes videre bare bak den eksisterende `?legacy=1`-visningen for teknisk feilsøking, aldri som fallback for nye importer.

## Hva «commit» betyr her (avklart)

`commit-cv-import` skriver **kun** til `public.cv_parse_candidates`. Den skriver aldri til `career_atoms` (eksplisitt i funksjonens kontrakt). Den er altså materialisering av parselaget, ikke godkjenning, og kan derfor kjøres automatisk. Formuleringen «commit av hele det analyserte settet» utgår; ingen filtrering på brukerens avhuking skjer lenger, fordi utvalget nå gjøres i Trinn 1–4.

Automatisk kjede skriver: `cv_imports`, `cv_parse_candidates`, `cv_atomization_jobs`, `cv_atomization_job_blocks`, `atom_enrichment_batches`/`atom_enrichment_proposals` (v2.1-forslag med provenance, rolleblokk, kilde-spenn), result-ledger og kompetansekonsolidering.

Automatisk kjede skriver **ikke**: `career_atoms`, `career_atom_links`, `cv_claim_attestations`, og setter aldri `user_attested`. Første skriving til `career_atoms` skjer først ved eksplisitt bekreftelse i review-flyten, via de kanoniske RPC-ene (`career_atom_promote_parse_candidate`, `career_atom_add_manual_result`, `career_atom_link_decide`, `career_atom_delete`).

## Endringer i opplastingsflyten

`src/components/cv-upload/cv-upload-flow.tsx`:

- Etter verifisert opplasting (og etter valg fra CV-arkivet) kjøres parse → kandidatmaterialisering → `startAtomizationJob` automatisk, uten «Analyser CV»-knapp.
- Fremdrift vises reelt per ansettelsesforløp/rolleblokk ved å gjenbruke fremdriftsvisningen fra `CvAnalysisPanel` (`followAtomizationJob`-polling). Ingen fallback til den gamle `propose-cv-atoms`-ruten.
- «Avbryt» stopper videre gjennomgang, men sletter ikke opplastet fil eller importrad.
- `parsed_preview`-tilstanden med `PreviewSummary`/`PreviewDetails`/avhuking fjernes fra flyten sammen med `selected`-tilstanden og `filterParsedData`-skrivingen.
- Sluttilstand: kort oppsummering (roller / resultater / kompetanser funnet) + `Gå gjennom nå` (→ `/career/cv-review?import=<id>`) og `Senere`.
- «Prøv analysen på nytt» vises kun i feiltilstand eller ved eksplisitt regenerering.

## Gjenopptak

`useResumableImport` utvides til å rute på faktisk tilstand:

| Tilstand | Handling |
| --- | --- |
| Atomisering pågår | Vis fremdrift, fortsett polling |
| Analyse ferdig, review ikke startet | Vis oppsummering med «Gå gjennom nå» |
| Review påbegynt | Rett til lagret trinn (`cv_review_progress`) |
| Review fullført | Vis oppsummering, ikke flat liste |
| Analyse feilet | Feilmelding + «Prøv analysen på nytt» |
| Gammel `parsed`-import uten v2.1-jobb | Knapp: «Start gjennomgang med v2.1» |

## Trinn 1–4 (uendret kontrakt, verifiseres)

Trinn 1 er første godkjenningspunkt: kronologisk tidslinje med arbeidsgiver, tittel og periode; overlappende roller som separate roller; provisoriske roller med ett samlet avklaringsspørsmål; gap-forslag kun ved tilstrekkelig datopresisjon og minst tre måneder; retting, sammenslåing og manuelt tillegg. `Privat` og `Freelance` er valgbare ved manuelt tillegg/omplassering, men opprettes aldri automatisk. Bulkbekreftelse kun for roller med høy sikkerhet, og alltid via den kanoniske promote-flyten.

Trinn 2–4 beholdes som i dag (strukturell plassering med høy sikkerhet, provisorisk rolle beholder sitt innhold, ekte uplassert vises separat; normaliserte kompetanser med konkret belegg; kvalifikasjoner/språk). Atombekreftelse holdes adskilt fra claim-attestasjon.

## Verifisering før levering

Ende-til-ende med den opplastede CV-en: automatisk start, ingen manuell analyseknapp, ingen flat liste, «Gå gjennom nå» åpner Trinn 1, `career_atoms` er tom til første eksplisitte bekreftelse (verifiseres med spørring), Cisco-topologi og provisorisk rolle som spesifisert, refresh/avbryt/gjenopptak, desktop og mobil. Rapport med hvilke tabeller som skrives automatisk versus etter brukerhandling.
