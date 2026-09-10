# Innkommende e-post — hva som er levert og hva som gjenstår

**Mottak er slått av.** Webhooken svarer `503 inbound_not_configured` til både
`INBOUND_EMAIL_DOMAIN` og en leverandørhemmelighet er satt. Ingen DNS er endret,
ingen leverandørhemmelighet er opprettet eller antatt av dette arbeidet.

## A. Levert i app og database

| Del | Beskrivelse |
| --- | --- |
| `src/lib/job-leads/inbound-alias.ts` | Genererer ugjennomsiktig alias: 160 tilfeldige bit, base32, aldri avledet av bruker-id. Leser og validerer alias fra mottakeradresse. |
| `POST /api/ai-integrations/inbound-address` | Oppretter eller rullerer brukerens private importadresse. Bruker-id kommer fra pålogging, aldri fra innholdet. |
| `DELETE /api/ai-integrations/inbound-address` | Slår av mottak for brukeren. Revisjonssporet beholdes. |
| `src/lib/job-leads/inbound-intake.server.ts` | Konfigurasjonsport og revisjonsspor. Leser kun om hemmeligheter finnes, aldri verdien. |
| `inbound_email_deliveries` (ny tabell) | Metadata og utfall per mottatt melding. Aldri e-postinnhold. Unik på (kilde, leverandør, meldings-id) — samme melding registreres én gang. |
| Eierskapsbinding | Sammensatt fremmednøkkel mot `email_job_sources(user_id, id)`: en melding kan ikke knyttes til feil bruker. |
| Tilgang | Kun serverrollen skriver. Innlogget bruker kan lese egne rader. Ingen anonym tilgang. |
| Formatkrav | `email_job_sources.inbound_alias_token` må matche `^[a-z2-7]{26,64}$`. |

Nettleseren kan aldri levere e-post inn: eneste inngang er den signerte
webhooken `POST /api/public/inbound/job-email`.

## B. Forutsetninger som må ordnes manuelt før mottak slås på

**DNS for `jobb.karrierenmin.no`** (verdier hentes fra leverandørens dashboard —
ingen verdier er oppdiktet her):

1. To MX-poster med ulik prioritet.
2. TXT (SPF) for mottaksdomenet.
3. TXT (DKIM) på `<selector>._domainkey.jobb.karrierenmin.no`.
4. TXT for domenebekreftelse.
5. Domenet må stå som verifisert hos leverandøren.

**Leverandør:**

6. Rute innkommende post for domenet til
   `https://karrierenmin.no/api/public/inbound/job-email` (POST).
7. Signering slått på: Lovable-veien (`x-lovable-signature`) eller Mailgun-veien.

**Hemmeligheter (Prosjektinnstillinger → Secrets, aldri i repo eller chat):**

8. `INBOUND_EMAIL_DOMAIN` = `jobb.karrierenmin.no`
9. `LOVABLE_API_KEY` (finnes) **eller** `MAILGUN_WEBHOOK_SIGNING_KEY`

## C. Verifikasjon etter aktivering

1. Opprett importadressen som testbruker under Innstillinger → Integrasjoner.
2. Send en jobbvarsel-e-post fra en ekstern avsender til adressen.
3. Godkjent når webhooken svarer 200, det ligger én rad i revisjonssporet med
   utfall `accepted`, og lead-en vises i Jobb-leads.
4. Send samme melding på nytt: svaret skal ha `duplicate: true` og
   revisjonssporet skal fortsatt ha én rad.

## D. Rollback

Fjern `INBOUND_EMAIL_DOMAIN` → webhooken svarer 503 og adressen skjules i
grensesnittet. Sett leverandørruten på pause og fjern MX-postene.
Ingen brukerdata slettes.
