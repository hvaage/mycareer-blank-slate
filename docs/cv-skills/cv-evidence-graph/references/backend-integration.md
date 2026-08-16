# Lovable/Claude-backend for evidensgrafen

## Kanonisk flyt

1. Inspiser faktiske atom- og proposal-tabeller før migrasjon.
2. Motta bare validert output fra `cv-atom-language-no`.
3. Konverter hver kandidat til `AtomProposal`, aldri direkte til en varig atom.
4. Kjør strukturell validering og deduplisering.
5. Lagre provenance, eksisterende snapshot og foreslått diff.
6. La brukeren godkjenne eller avvise.
7. Bruk en server-side transaksjon ved apply; verifiser eierskap og at mål-atomet ikke er endret siden snapshot.

## Beskyttelse av brukerens sannhet

- `user_locked=true`: ingen AI/import-endring.
- `user_confirmed=true` eller `confidence=verified`: behold eksisterende formulering og verdier; foreslå bare tillegg.
- `confidence=inferred`: må aldri inngå i generering før eksplisitt godkjenning.
- AI kan foreslå merge, men automatisk merge er bare tillatt for uverifiserte importerte atoms der patchen fyller tomme felt.

## Idempotens

Bruk `(user_id, source_hash, target_entity_type, target_entity_id, semantic_key)` som idempotensgrunnlag i proposal-laget. Ikke opprett duplikate forslag for samme kildeversjon.

## Edge Functions

- `parse-uploaded-cv`: parser dokument og lagrer kildeversjon.
- `propose-cv-atoms`: normaliserer med Claude, validerer og lager forslag.
- `review-atom-proposal`: approve/reject/needs_more_context.
- `apply-atom-proposal`: intern transaksjonell helper, ikke klientstyrt fri payload.

Claude API-nøkkel ligger kun som secret. Bruk eksisterende RLS og `auth.uid()`; service role må ikke gjøre bruker-id fra request body autoritativ.

## Databasemigrasjon

De nye semantikkfeltene i schema 1.1 ligger i `structured_data` og krever ikke kolonneendring i `cv_evidence_atoms`. Proposal-kontrakten skal mappes til eksisterende enrichment-tabeller dersom de finnes. Ikke opprett parallelle tabeller uten først å dokumentere at proposal-modellen mangler.
