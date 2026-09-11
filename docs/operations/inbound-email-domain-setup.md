# Oppsett av innkommende e-postdomene (jobb.karrierenmin.no)

**Status: IKKE KONFIGURERT.** Verken DNS eller serverhemmeligheter er endret.
`INBOUND_EMAIL_DOMAIN` og `RESEND_WEBHOOK_SECRET` er ikke satt, og mottaket er
derfor avslått i koden. Dokumentet beskriver hva som må gjøres.

## 1. Mottaksleverandør — kun Resend

Webhooken `src/routes/api/public/inbound/job-email.ts` støtter **én** vei:
Resends offisielle webhook-kontrakt med Svix-signatur («Standard Webhooks»).

- Signert innhold: `<svix-id>.<svix-timestamp>.<rå request body>`.
- Signatur: `base64(HMAC-SHA256(base64decode(secret uten "whsec_"), signert innhold))`.
- Headeren `svix-signature` (alternativt `webhook-signature`) inneholder en
  mellomromseparert liste av `v1,<base64>`; én match verifiserer leveransen.
- Toleranse for `svix-timestamp` er ±5 minutter i begge retninger.
- Verifisering skjer alltid mot **rå** request body, aldri mot re-serialisert JSON.

Mailgun-veien er fjernet. `MAILGUN_WEBHOOK_SIGNING_KEY` og `LOVABLE_API_KEY`
har ingen betydning for mottaket.

## 2. Konfigurasjonsport

Handleren returnerer `503 inbound_not_configured` så lenge én av disse mangler:

| Navn                    | Rolle                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `INBOUND_EMAIL_DOMAIN`  | Mottaksdomenet, f.eks. `jobb.karrierenmin.no`. Alias godtas kun på nøyaktig dette domenet. |
| `RESEND_WEBHOOK_SECRET` | Resends webhook-secret (`whsec_…`) for endepunktet.                                        |

Legges inn under Prosjektinnstillinger → Secrets. Aldri i repo, aldri i chat.

## 3. Aliasregler

- Adressen er `<token>@<INBOUND_EMAIL_DOMAIN>`.
- Token er 26–64 tegn lowercase base32 (`a–z`, `2–7`).
- Subdomener, overdomener, suffiks-varianter (`...no.evil.com`),
  plussadressering og ukjente verter avvises som `unknown_alias` (404).
- Resend mottar e-post på et eget verifisert subdomene, men aliaskontrollen i
  koden er uavhengig av dette og krever eksakt domenetreff.

## 4. DNS — posttyper som må opprettes

Alle verdier hentes fra Resends eget dashboard. Ingen verdier er oppgitt her,
fordi oppdiktede MX-, SPF- eller DKIM-verdier ville vært verre enn ingen.

| Type                    | Navn                                         | Verdi hentes fra             |
| ----------------------- | -------------------------------------------- | ---------------------------- |
| MX                      | `jobb.karrierenmin.no`                       | Resend «Inbound / Receiving» |
| TXT (SPF)               | `jobb.karrierenmin.no`                       | Resends SPF-streng           |
| TXT (DKIM)              | `<selector>._domainkey.jobb.karrierenmin.no` | Resends DKIM-nøkkel          |
| TXT (domenebekreftelse) | som Resend angir                             | Resends verifiseringssteg    |

Domenet må stå som verifisert hos Resend før noe testes.

## 5. Webhook-URL

```
https://<produksjonsdomene>/api/public/inbound/job-email
```

Resend-webhooken for `email.received` peker hit. Ruten ligger under
`/api/public/`, men verifiserer signatur selv. Webhook-secreten fra Resend
lagres som `RESEND_WEBHOOK_SECRET`.

## 6. Hendelsestype

Bare `email.received` behandles. Andre eventtyper kvitteres med `202` og
ignoreres, slik at Resend ikke retrier dem i det uendelige.

## 7. Idempotens

Hver leveranse claimes atomisk i `inbound_email_deliveries`, unikt på
`(email_job_source_id, provider, provider_message_id)`, **før**
`ingestParsedEmail`. Replay og samtidige leveranser av samme melding gir
maksimalt én import og én jobb-lead. Duplikater svarer `200 { duplicate: true }`.

## 8. Verifikasjonstest

1. Sett begge hemmelighetene og vent til DNS har propagert.
2. Logg inn som testbruker og les den private importadressen i
   Innstillinger → Integrasjoner.
3. Send en ekte jobbvarsel-e-post fra en **ekstern** avsender til adressen.
4. Godkjent når: webhooken svarer 200, e-posten er registrert som mottatt for
   riktig bruker, og lead-en dukker opp i Jobb-leads.
5. Underkjent når: 503 (ikke konfigurert), 401 (signatur), 404 (ukjent alias)
   eller ingen lead.
6. Bruk «Resend event» i Resends dashboard: forventet `200 { duplicate: true }`
   og ingen ny lead.

## 9. Rollback

1. Fjern `INBOUND_EMAIL_DOMAIN` (eller `RESEND_WEBHOOK_SECRET`). Mottaket slår
   seg av med 503, og grensesnittet faller tilbake til nøytral tekst.
2. Deaktiver webhooken og mottaksruten hos Resend.
3. Fjern MX-postene for `jobb.karrierenmin.no`. La SPF/DKIM stå.
4. Ingen brukerdata slettes; allerede mottatte leads er upåvirket.

## Tilstandsmodell for leveranser (retry-trygg)

Hver leveranse har nøyaktig én rad i `inbound_email_deliveries` per
`(email_job_source_id, provider, provider_message_id)`. Leverandørverdien er
`resend`.

- **Meldingsidentitet**: originalt `Message-ID`-header når det finnes, ellers
  Resend/Svix-eventets id (`svix-id`), som er stabil på tvers av retries. Uten
  begge hashes kun uforanderlig meldingsinnhold (avsender, mottaker, emne,
  tekst, HTML). Mottakstidspunkt, webhook-timestamp og signatur inngår aldri.
- **`processing`** er eneste aktive lease-status. Reservasjonen skjer atomisk i
  `inbound_email_claim_delivery` med radlås og advisory lock, og gir et
  engangs claim-token med leieutløp (standard 300 sekunder).
- **`accepted`** settes først etter at både importen og jobb-leaden er lagret,
  gjennom `inbound_email_finalize_delivery`. `accepted` er terminal: senere
  replay svarer `200 { duplicate: true }`.
- **`parse_failed` / `ingest_failed`** er ikke-terminale. Et senere legitimt
  forsøk kan claime samme melding på nytt og få nytt forsøksnummer.
- **Krasj underveis**: når leien utløper registreres forsøket som
  `lease_expired`, og neste forsøk overtar. En gammel worker med utdatert
  claim-token kan ikke ferdigstille (`lease_lost`).
- **Revisjonsspor**: `inbound_email_delivery_attempts` er append-only og
  bevarer hvert forsøk med utfall, begrunnelse og tidspunkter. Brukere kan
  bare lese sine egne rader.
- **Krasjvinduet** mellom opprettet import og terminal `accepted` er lukket av
  en unik databaseindeks på `imported_job_emails (email_job_source_id,
provider_message_id)`; en retry gjenbruker eksisterende import.
- **Tilgang**: begge funksjonene er SECURITY INVOKER med fast `search_path` og
  `EXECUTE` kun for `service_role`. Verifisert: anon får `42501`.

## Resend Receiving API (metadata-only webhook)

Resend's `email.received` webhook carries METADATA ONLY: no body, no complete
headers and no attachment content. After signature verification, recipient
validation and a successful atomic claim, the server fetches the full message:

```
GET https://api.resend.com/emails/receiving/:email_id
Authorization: Bearer $RESEND_API_KEY
```

Rules enforced in code:

- fixed API origin, explicit 15 s timeout, 2 MB response limit,
- the API key and the message content are never logged,
- no API call for an invalid signature, an unknown alias, a duplicate
  (`accepted`) or a live lease (`in_progress`),
- timeout / 429 / 5xx / 404 / 401 / 403 finalize as retryable `ingest_failed`;
  other 4xx, malformed payloads and oversized messages finalize as
  `parse_failed`,
- message identity: original `Message-ID` when available, otherwise Resend's
  immutable `email_id`, otherwise the Svix event id. Receipt time is never used.

### Attachments

Attachment CONTENT is NOT ingested. The current job-lead pipeline parses text
and HTML only, so the Receiving Attachments API is not called. Attachment
metadata (id, filename, content type, size) is available on the fetched email
and is deliberately not presented as processed content.

### Required server settings

- `INBOUND_EMAIL_DOMAIN=jobb.karrierenmin.no`
- `RESEND_WEBHOOK_SECRET`
- `RESEND_API_KEY`

Intake stays closed (HTTP 503) unless all three are present.

### Private forwarding address

Each user gets one address `<alias>@jobb.karrierenmin.no`. The alias is a
32-character base32 token from server-side cryptographic randomness, never
derived from the user id or e-mail, uniquely bound to the user in the database
and readable only by its owner in Settings → Integrations.
