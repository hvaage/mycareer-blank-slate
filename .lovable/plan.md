# Plan: Analysedokument-lenke på Jobb-leads + deploy av analyse-funksjonen

## Bakgrunn
Fiksen som gjør at arbeidsgiveranalysen lagres som dokument (document_group_id = egen id) ligger allerede i koden, men bakgrunnsfunksjonen er ikke deployet. Når analysen finnes som dokument, skal Jobb-leads vise en lenke til den ved siden av selskapsnavnet på annonsekortet.

## Endringer

### 1. Deploy av analyse-funksjonen
- Deploy edge-funksjonen `analyze-company` til produksjon slik at analysen lagres i dokumentlisten med `artifact_document_id` koblet på jobben.
- Verifiser JWT-verifisering aktiv (iht. `supabase/config.toml`: `verify_jwt = true`).

### 2. Lenke til analysedokument på Jobb-leads
- Gjenbruk `employerAnalysisDocLinksQuery()` (navnebasert, usikker-koblingslogikk finnes allerede) på `src/routes/_authenticated/job-leads.tsx`.
- Bygg oppslag fra selskapsnavn (små bokstaver, trimmet) → analysedokument-id.
- På annonsekortet, ved siden av selskapsnavnet: vis en liten lenke «Arbeidsgiveranalyse» (FileText-ikon) til `/documents/$id` når det finnes et analysedokument for selskapet.
- Lenken vises kun når dokumentet faktisk finnes — ingen lenke, ingen knapp for selskaper uten analyse.
- Lenken er en vanlig intern lenke (ikke knapp) slik at den ikke forstyrrer kortets eksisterende klikkflate.

### 3. Verifisering
- `tsgo` typecheck, `eslint`, `bunx vitest run` (full suite), `vite build`.
- Etter deploy: bekreft at en ny analyse av et testselskap oppretter dokument og at `employer_analysis_jobs.artifact_document_id` settes (read-only spørring).
- Rapporter deploy-status og live URL. Ingen publisering av appen utover deploy av edge-funksjonen uten godkjenning.

## Tekniske detaljer
- Berørte filer: `supabase/functions/analyze-company/index.ts` (allerede fikset, kun deploy), `src/routes/_authenticated/job-leads.tsx` (lenke), gjenbruk av `src/lib/queries/employer-analysis-docs.ts`.
- Ingen databaseendringer, ingen migrasjon.
- Navnematching er bevisst konservativ: kun eksakt navnetreff (case-insensitiv) gir lenke.
