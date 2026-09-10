# Plan: retrybar og atomisk innkommende e-post

## Mål

Samme leverandørmelding skal kunne prøves på nytt etter `parse_failed`, `ingest_failed` eller en utløpt/krasjet reservasjon, uten at samtidige kall eller replay etter suksess kan opprette flere importer eller jobb-leads.

## Tilstandsmodell

- Behold `inbound_email_deliveries` som den kanoniske raden per `(email_job_source_id, provider, provider_message_id)`.
- Utvid statusene med `processing` som eneste aktive lease-status, og legg til et tilfeldig claim-token, lease-utløp og forsøksteller. `accepted` settes først etter at både import og jobb-lead er fullført.
- Opprett en egen append-only forsøkstabell som bevarer hvert claim, feilutfall, begrunnelse og tidspunkt.
- En databasefunksjon utfører claim atomisk under transaksjonslås:
  - `accepted` gir alltid `duplicate`.
  - aktiv `processing` gir `duplicate/in_progress`.
  - `parse_failed`, `ingest_failed` eller utløpt `processing` får et nytt claim-token og nytt forsøk.
- Ferdigstilling krever riktig claim-token. Bare innehaveren av gjeldende lease kan sette `accepted`, `parse_failed` eller `ingest_failed`.
- En utløpt `processing` registreres som et krasjet/avbrutt forsøk før neste claim.

## Beskyttelse mot krasj etter delvis ingest

- Den unike importidentiteten håndheves i databasen på importlaget (unik indeks på kilde + provider-message-id), ikke bare i webhook-koden.
- Meldingsidentiteten er stabil: Mailguns `Message-Id` når den finnes, ellers en dokumentert fallback over uforanderlig meldingsinnhold. Mottakstidspunkt inngår aldri.
- Gjør `ingestParsedEmail` gjenopptakbar: ved retry gjenbrukes eksisterende import, og eksisterende lead-deduplisering hindrer et ekstra jobb-lead.
- Først når hele ingestløpet er ferdig, ferdigstilles leveransen som terminal `accepted`.

## Database og tilgang

- Lag én additiv migrasjon med nye kolonner, forsøkstabell, indekser og atomiske claim/finalize-funksjoner.
- Forsøkstabellen får eksplisitte grants, RLS og kun eierlesing for innloggede brukere; webhook-skriving skjer kun server-side.
- Claim- og finalize-funksjonene er SECURITY INVOKER, med fast `search_path` og execute kun for `service_role`. Ingen klient kan claime eller ferdigstille direkte.
- Oppdater genererte databasetyper etter anvendt migrasjon.

## Kode og dokumentasjon

- Bytt webhooken fra direkte insert/update til claim/finalize-funksjonene.
- Oppdater ingest til å gjenoppta en allerede opprettet import trygt.
- Oppdater runbooken med retry-, lease- og terminalstatusreglene.

## Verifisering

- Kjør reelle samtidige databasekall i rollback-isolerte testscenarioer:
  1. Ett claim lykkes og 24 samtidige replay går ikke videre.
  2. `ingest_failed`, deretter retry som lykkes.
  3. `parse_failed`, deretter retry som lykkes.
  4. Utløpt/krasjet lease kan tas over, mens gammel claim-token ikke kan ferdigstille.
- Kontroller at det finnes nøyaktig én import og høyst ett jobb-lead etter suksess.
- Kontroller RLS, grants og funksjonsrettigheter på ny struktur.
- Kjør målrettede tester, full testpakke, typekontroll, lint og build.
- Ikke publiser.

## Teknisk merknad

Databaselåsen serialiserer claim-beslutningen. Claim-tokenet hindrer en gammel worker i å ferdigstille etter at en lease er overtatt. Den unike importidentiteten og eksisterende lead-dedupliseringen lukker krasjvinduet mellom importopprettelse og terminal `accepted`.
