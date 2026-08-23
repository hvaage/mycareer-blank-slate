# Trinn B — Inntak og parsing av jobb-e-post

Bygger på Trinn A-datamodellen (`imported_job_emails`, `email_job_sources`, utvidet
`job_leads`). Ingen nye tabeller kreves; ingen endring i dedupe-nøklene.

Driftspunktet er notert og innarbeidet: `inbound_alias_token` er kun UNIQUE i databasen.
Ugjettbarheten sikres i koden som oppretter raden — 32 byte fra `crypto.getRandomValues`,
base32-kodet, aldri avledet av bruker-id, og alltid generert serverside.

## B1 — Felles parser-modul (Finn + LinkedIn)

Én modul, `src/lib/job-leads/parse/` (rene funksjoner, ingen I/O, enhetstestbar):

```text
prefilter  ->  selectors (per kilde)  ->  [AI-fallback]  ->  normalisering
```

- `prefilter`: avgjør kilde (`finn` / `linkedin` / ukjent) fra avsender og emne, og forkaster
  åpenbart ikke-relevante e-poster med `reject_reason` (`not_job_alert`, `no_listings`,
  `unknown_sender`).
- `selectors`: faste HTML/tekst-uttrekk per kilde. En jobbvarsel-e-post inneholder flere
  annonser, så parseren returnerer en liste av kandidater, ikke én.
- AI-fallback: kalles **bare** når selectors gir null treff på en e-post som passerte
  prefilter. Én modellkall per e-post, ikke per annonse. Resultatet merkes
  `parse_confidence` lavere enn selector-treff.
- Utdata per kandidat: `title`, `company`, `location`, `job_url` (avsporet fra
  redirect/tracking-URL til kanonisk annonse-URL), `posted_text`/`raw_snippet`,
  `application_due` når oppgitt, `parse_confidence`, evt. `reject_reason`.

Gjelder kun e-postkildene. NAV og Careerjet er strukturerte feeder og røres ikke.

## B2 — Gmail og Outlook bak samme abstraksjon

`src/lib/job-leads/mailbox/` med ett grensesnitt og to implementasjoner:

```text
MailboxProvider = { connect, listSince, fetchMessage, refreshToken }
```

- Gmail: OAuth med `gmail.readonly`, `historyId`/`internalDate` som inkrementell markør.
- Outlook: Microsoft Graph, `receivedDateTime` som markør.
- Begge lagrer tokens i `email_connections` (finnes allerede, med `provider`-enum) og
  markøren i `last_synced_internal_date`. Tokenfornyelse skjer i abstraksjonen, ikke i
  kallstedene.
- `EmailConnections`-stubben (`src/components/email-connections.tsx`) erstattes av reell
  tilkoblingsflate: koble til, vis status, velg søkefilter, koble fra.
- Samtykketeksten sier eksplisitt at lesescopet er bredere enn «kun jobbvarsler».

## B3 — Videresending via Mailjet inbound

- Rute: `src/routes/api/public/inbound/job-email.ts` (POST).
- Sikkerhet i handleren, i denne rekkefølgen: størrelsesgrense → signaturverifisering fra
  Mailjet (delt hemmelighet, `timingSafeEqual`) → rate-limiting per alias og per IP →
  Zod-validering → oppslag av alias → skriv rå e-post.
- Alias: `<token>@jobb.karrierenmin.no`, token generert som beskrevet øverst. Ukjent alias
  gir 404 uten å avsløre om aliaset finnes.
- Brukeren ser sitt alias i tilkoblingsflaten og kan rullere det (nytt token, gammelt dør).

## B4 — Skriving til `job_leads`

- Rå e-post lagres først i `imported_job_emails` (egen, kortere oppbevaringstid).
- Parsede kandidater upsertes mot eksisterende `idx_job_leads_dedupe`, med
  `source_system` (`finn`/`linkedin`), `source_url_hash`, `imported_job_email_id`,
  `parse_confidence`, `raw_payload` og status fra dagens enum (`ny`/`avvist`/…).
- Kandidater under konfidensterskel skrives med `qualification_status='needs_review'`
  i stedet for å forkastes stille.
- Registrering i `lead_dedupe_keys` skjer ved innhenting.

## B5 — UI: rett hardkodet kilde

`src/routes/_authenticated/job-leads.tsx` linje 345 setter `source: "linkedin"` for alle
`job_leads`-rader. Leses fra `source_system` og mappes til etikett; kildefilteret utvides
med `finn` (og `e-post` som samlekategori der det gir mening).

## Teknisk

- Ingen Supabase edge-funksjoner: inntak og parsing kjører som `createServerFn` +
  server-rute for Mailjet-callbacken.
- Hemmeligheter som må inn før bygging: Google OAuth (client id/secret), Microsoft OAuth
  (client id/secret/tenant), Mailjet inbound-signeringshemmelighet.
- Enhetstester for parseren mot lagrede eksempel-e-poster; ingen nettverksavhengighet.

## Rekkefølge

B1 (parser + tester) → B2 og B3 parallelt → B4 → B5 → verifikasjon mot ekte e-poster.
