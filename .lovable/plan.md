# Trinn B — Inntak og parsing av jobb-e-post (revidert)

Bygger på Trinn A-datamodellen (`imported_job_emails`, `email_job_sources`, utvidet
`job_leads`). B1, B4 og B5 er uendret. B2 får en presisering, B3 er rettet på leverandør,
og rate-limiting har fått navngitt lagringssted.

Verifisert i repoet før denne planen: `mailjet` finnes ikke i kildekoden;
`@lovable.dev/email-js` og `@lovable.dev/webhooks-js` ligger i `package.json`;
`src/routes/lovable/email/suppression.ts` bruker `verifyWebhookRequest` med
`LOVABLE_API_KEY` og sier i kommentar at hendelsene kommer fra Mailgun;
`src/routes/api/public/ingest-report.ts` har allerede hashet IP + telling + 429;
`wrangler.jsonc` har ingen KV- eller Durable Object-binding.

`inbound_alias_token` er kun UNIQUE i databasen — ugjettbarheten sikres i koden:
32 byte fra `crypto.getRandomValues`, base32-kodet, serverside, aldri avledet av bruker-id.

## B1 — Felles parser-modul (Finn + LinkedIn) — uendret

`src/lib/job-leads/parse/`, rene funksjoner uten I/O:

```text
prefilter  ->  selectors (per kilde)  ->  [AI-fallback]  ->  normalisering
```

- `prefilter`: bestemmer kilde fra avsender/emne, forkaster irrelevant med `reject_reason`
  (`not_job_alert`, `no_listings`, `unknown_sender`).
- `selectors`: faste uttrekk per kilde; en varsel-e-post gir en **liste** av kandidater.
- AI-fallback bare når selectors gir null treff på en e-post som passerte prefilter —
  ett modellkall per e-post, ikke per annonse, og lavere `parse_confidence`.
- Utdata per kandidat: `title`, `company`, `location`, kanonisk `job_url` (tracking-URL
  avsporet), `posted_text`/`raw_snippet`, `application_due`, `parse_confidence`,
  evt. `reject_reason`.
- Enhetstester mot lagrede eksempel-e-poster, ingen nettverksavhengighet.
- Gjelder kun e-postkildene. NAV og Careerjet røres ikke.

## B2 — Gmail og Outlook bak samme abstraksjon

`src/lib/job-leads/mailbox/` med ett grensesnitt og to implementasjoner:

```text
MailboxProvider = { connect, listSince, fetchMessage, refreshToken }
```

- Gmail: OAuth `gmail.readonly`, `internalDate`/`historyId` som inkrementell markør.
- Outlook: Microsoft Graph, `receivedDateTime` som markør.
- **Presisering (bekreftet krav):** `email_connections.provider` er begrenset til
  `'google'` og `'microsoft'`. Gmail-tilkoblingen skriver `'google'`,
  Outlook-tilkoblingen skriver `'microsoft'`. Ordene «gmail»/«outlook» brukes kun som
  etiketter i grensesnittet, aldri som kolonneverdi. Constraint-en leses av i koden før
  første innsetting.
- Tokens i `email_connections`, markør i `last_synced_internal_date`. Tokenfornyelse
  ligger i abstraksjonen, ikke i kallstedene.
- `src/components/email-connections.tsx` (stub i dag) erstattes av reell tilkoblingsflate:
  koble til, status, søkefilter, koble fra. Samtykketeksten sier eksplisitt at lesescopet
  er bredere enn «kun jobbvarsler».

## B3 — Videresending: Lovable-infrastruktur først, Mailgun som fallback

**Steg 1 — avklaring før bygging.** Undersøk om innkommende e-post kan mottas gjennom
samme Lovable-administrerte e-postinfrastruktur som allerede leverer bounce/complaint til
`src/routes/lovable/email/suppression.ts`. Ingen frittstående tredjepartsintegrasjon og
ingen ny API-nøkkel før dette er avklart. Mailjet er forkastet — leverandøren bak dagens
e-posthendelser er Mailgun.

**Steg 2 — implementasjon.**

- Rute: `src/routes/api/public/inbound/job-email.ts` (POST), samme handler uansett om
  hendelsen kommer fra Lovable-infrastrukturen eller direkte fra Mailgun.
- Signaturverifisering med `verifyWebhookRequest` fra `@lovable.dev/webhooks-js`, samme
  mønster som `suppression.ts`. Ingen håndrullet `timingSafeEqual`.
- Rekkefølge i handleren: størrelsesgrense → signaturverifisering → rate-limiting →
  Zod-validering → aliasoppslag → lagring.
- Alias: `<token>@jobb.karrierenmin.no`, token som beskrevet øverst. Ukjent alias gir 404
  uten å avsløre om aliaset finnes. Brukeren kan rullere aliaset (nytt token, gammelt dør).

## Rate-limiting — lagringssted valgt

Valget mellom «kolonne» og «egen telle-tabell» er tatt: **`ip_hash`-kolonne på
`imported_job_emails`**, ingen ny tabell.

- Samme mønster som `ingest-report.ts`: SHA-256-hash av avsender-IP lagres som kolonne,
  telles mot et tidsvindu med `supabaseAdmin`, 429 ved overskridelse.
- To tellinger mot samme tabell med ulike vinduer — alias- og IP-grensene trenger ikke
  hver sin tabell for å ha hvert sitt vindu:
  - per alias: antall rader for aliaset siste time,
  - per `ip_hash`: antall rader for IP-en siste døgn.
- Forutsetning som må holdes: også avviste/uparsede e-poster skrives som rad (med
  `reject_reason`), ellers teller ikke grensen misbruk som aldri produserer leads.
- Migrasjonen legger til `ip_hash text` + indeks på `(ip_hash, created_at)` og
  `(inbound_alias_token, created_at)`-ekvivalenten for tellespørringene.

## B4 — Skriving til `job_leads` — uendret

- Rå e-post lagres først i `imported_job_emails` (kortere oppbevaringstid enn det
  strukturerte resultatet).
- Kandidater upsertes mot eksisterende `idx_job_leads_dedupe`, med `source_system`
  (`finn`/`linkedin`), `source_url_hash`, `imported_job_email_id`, `parse_confidence`,
  `raw_payload` og status fra dagens enum.
- Under konfidensterskel → `qualification_status='needs_review'`, ikke stille forkasting.
- `lead_dedupe_keys` registreres ved innhenting.

## B5 — Rett hardkodet kilde — uendret

`src/routes/_authenticated/job-leads.tsx` linje 345 setter `source: "linkedin"` for alle
`job_leads`-rader. Leses fra `source_system` og mappes til etikett; kildefilteret utvides
med `finn`.

## Teknisk

- Ingen edge-funksjoner: `createServerFn` for inntak/parsing, server-rute for webhooken.
- Hemmeligheter: Google OAuth (client id/secret), Microsoft OAuth (client id/secret/tenant).
  `LOVABLE_API_KEY` finnes allerede og brukes til signaturverifisering.
- Ingen KV/Durable Object innføres; all telling går mot databasen.

## Rekkefølge

B1 (parser + tester) → B3 steg 1 (leverandøravklaring) → B2 og B3 steg 2 parallelt →
rate-limit-migrasjon → B4 → B5 → verifikasjon mot ekte e-poster.
