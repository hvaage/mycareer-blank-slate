# Oppsett av innkommende e-postdomene (jobb.karrierenmin.no)

**Status: IKKE KONFIGURERT.** Verken DNS eller serverhemmeligheter er endret av
dette oppdraget. `INBOUND_EMAIL_DOMAIN` er ikke satt. Dokumentet beskriver hva
som må gjøres, ikke hva som er gjort.

## 1. Mottaksleverandør — basert på eksisterende webhook

Webhooken `src/routes/api/public/inbound/job-email.ts` støtter i dag to signerte
inngangsveier, og oppsettet må velge én av dem:

| Vei | Signaturverifisering | Nødvendig hemmelighet |
| --- | --- | --- |
| Lovable-styrt e-postmottak | `verifyWebhookRequest` fra `@lovable.dev/webhooks-js`, headere `x-lovable-signature` / `x-lovable-timestamp` | `LOVABLE_API_KEY` (finnes allerede) |
| Mailgun direkte | HMAC-SHA256 over `timestamp + token` | `MAILGUN_WEBHOOK_SIGNING_KEY` |

Anbefaling: bruk Lovable-veien hvis plattformens e-postmottak dekker et eget
subdomene, siden hemmeligheten allerede finnes og koden allerede verifiserer den.
Velges Mailgun, må Mailgun-ruten peke på samme webhook-URL.

## 2. DNS — posttyper som må opprettes

Alle verdier hentes fra den valgte leverandørens eget dashboard. **Ingen verdier
er oppgitt her, fordi oppdiktede MX-, SPF- eller DKIM-verdier ville vært verre
enn ingen.**

| Type | Navn | Verdi hentes fra |
| --- | --- | --- |
| MX (to poster, ulik prioritet) | `jobb.karrierenmin.no` | leverandørens «Receiving / Inbound domain»-side |
| TXT (SPF) | `jobb.karrierenmin.no` | leverandørens SPF-streng for mottaksdomenet |
| TXT (DKIM) | `<selector>._domainkey.jobb.karrierenmin.no` | DKIM-nøkkelen leverandøren genererer for domenet |
| TXT (domenebekreftelse) | som leverandøren angir | leverandørens verifiseringssteg |

Domenet må stå som verifisert i leverandørens dashboard før noe testes.

## 3. Webhook-URL

```
https://<produksjonsdomene>/api/public/inbound/job-email
```

Stabil produksjonsadresse kan brukes i stedet for et omdøpbart domenenavn.
Ruten ligger under `/api/public/`, men verifiserer signatur selv.

## 4. Nødvendige serverhemmeligheter (navn, aldri verdier)

| Navn | Rolle |
| --- | --- |
| `INBOUND_EMAIL_DOMAIN` | Settes til `jobb.karrierenmin.no`. Uten denne vises ingen importadresse i grensesnittet. |
| `LOVABLE_API_KEY` | Signaturverifisering for Lovable-veien. Finnes allerede. |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | Kun hvis Mailgun-veien velges. |

Legges inn under Prosjektinnstillinger → Secrets. Aldri i repo, aldri i chat.

## 5. Verifikasjonstest

1. Sett hemmelighetene og vent til DNS har propagert.
2. Logg inn som testbruker og les den private importadressen i
   Innstillinger → Integrasjoner. Adressen vises bare når både domenet er satt
   og brukeren har en aliasnøkkel.
3. Send en ekte jobbvarsel-e-post fra en **ekstern** avsender (ikke fra
   systemet selv) til den private adressen.
4. Godkjent når: webhooken svarer 200, e-posten er registrert som mottatt for
   riktig bruker, og lead-en dukker opp i Jobb-leads.
5. Underkjent når: 401 (signatur), 404/ukjent alias, eller ingen lead.

## 6. Rollback

1. Fjern `INBOUND_EMAIL_DOMAIN`. Grensesnittet faller tilbake til nøytral tekst
   uten å love at adressen er aktiv.
2. Sett mottaksruten hos leverandøren på pause.
3. Fjern MX-postene for `jobb.karrierenmin.no`. La SPF/DKIM stå til domenet
   eventuelt avvikles helt.
4. Ingen brukerdata slettes; allerede mottatte leads er upåvirket.
