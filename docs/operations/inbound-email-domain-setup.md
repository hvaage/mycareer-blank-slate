# Oppsett av innkommende e-postdomene (jobb.karrierenmin.no)

**Status: IKKE KONFIGURERT.** Verken DNS eller serverhemmeligheter er endret.
`INBOUND_EMAIL_DOMAIN` og `MAILGUN_WEBHOOK_SIGNING_KEY` er ikke satt, og
mottaket er derfor avslått i koden. Dokumentet beskriver hva som må gjøres.

## 1. Mottaksleverandør — kun Mailgun

Webhooken `src/routes/api/public/inbound/job-email.ts` støtter **én** vei:
Mailgun med HMAC-SHA256-signatur over `timestamp + token`, verifisert mot
`MAILGUN_WEBHOOK_SIGNING_KEY`.

Den tidligere «Lovable-veien» er fjernet. `LOVABLE_API_KEY` er en API-nøkkel
for plattformtjenester, ikke en signeringsnøkkel for innkommende e-post, og
brukes ikke lenger som webhook-signatur her.

## 2. Konfigurasjonsport

Handleren returnerer `503 inbound_not_configured` så lenge én av disse mangler:

| Navn | Rolle |
| --- | --- |
| `INBOUND_EMAIL_DOMAIN` | Mottaksdomenet, f.eks. `jobb.karrierenmin.no`. Alias godtas kun på nøyaktig dette domenet. |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | Mailguns signeringsnøkkel for webhooken. |

Legges inn under Prosjektinnstillinger → Secrets. Aldri i repo, aldri i chat.

## 3. Aliasregler

- Adressen er `<token>@<INBOUND_EMAIL_DOMAIN>`.
- Token er 26–64 tegn lowercase base32 (`a–z`, `2–7`).
- Subdomener, overdomener, suffiks-varianter (`...no.evil.com`),
  plussadressering og ukjente verter avvises som `unknown_alias` (404).

## 4. DNS — posttyper som må opprettes

Alle verdier hentes fra Mailguns eget dashboard. Ingen verdier er oppgitt her,
fordi oppdiktede MX-, SPF- eller DKIM-verdier ville vært verre enn ingen.

| Type | Navn | Verdi hentes fra |
| --- | --- | --- |
| MX (to poster, ulik prioritet) | `jobb.karrierenmin.no` | Mailgun «Receiving / Inbound domain» |
| TXT (SPF) | `jobb.karrierenmin.no` | Mailguns SPF-streng |
| TXT (DKIM) | `<selector>._domainkey.jobb.karrierenmin.no` | Mailguns DKIM-nøkkel |
| TXT (domenebekreftelse) | som Mailgun angir | Mailguns verifiseringssteg |

Domenet må stå som verifisert hos Mailgun før noe testes.

## 5. Webhook-URL

```
https://<produksjonsdomene>/api/public/inbound/job-email
```

Mailgun-ruten («Store and notify» / «Forward») peker hit. Ruten ligger under
`/api/public/`, men verifiserer signatur selv.

## 6. Idempotens

Hver leveranse krever først en rad i `inbound_email_deliveries`, unikt på
`(email_job_source_id, provider, provider_message_id)`. Kravet skjer **før**
`ingestParsedEmail`, så replay og samtidige leveranser av samme melding gir
maksimalt én import og én jobb-lead. Duplikater svarer `200 { duplicate: true }`.

## 7. Verifikasjonstest

1. Sett begge hemmelighetene og vent til DNS har propagert.
2. Logg inn som testbruker og les den private importadressen i
   Innstillinger → Integrasjoner.
3. Send en ekte jobbvarsel-e-post fra en **ekstern** avsender til adressen.
4. Godkjent når: webhooken svarer 200, e-posten er registrert som mottatt for
   riktig bruker, og lead-en dukker opp i Jobb-leads.
5. Underkjent når: 503 (ikke konfigurert), 401 (signatur), 404 (ukjent alias)
   eller ingen lead.
6. Send samme melding på nytt: forventet `200 { duplicate: true }` og ingen ny
   lead.

## 8. Rollback

1. Fjern `INBOUND_EMAIL_DOMAIN` (eller `MAILGUN_WEBHOOK_SIGNING_KEY`). Mottaket
   slår seg av med 503, og grensesnittet faller tilbake til nøytral tekst.
2. Sett mottaksruten hos Mailgun på pause.
3. Fjern MX-postene for `jobb.karrierenmin.no`. La SPF/DKIM stå.
4. Ingen brukerdata slettes; allerede mottatte leads er upåvirket.

## Tilstandsmodell for leveranser (retry-trygg)

Hver leveranse har nøyaktig én rad i `inbound_email_deliveries` per
`(email_job_source_id, provider, provider_message_id)`.

- **Meldingsidentitet**: Mailguns `Message-Id` brukes når den finnes. Uten den
  hashes kun uforanderlig meldingsinnhold (avsender, mottaker, emne, tekst,
  HTML). Mottakstidspunkt, webhook-timestamp, token og signatur inngår aldri,
  slik at en redelivery gir samme identitet.
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
