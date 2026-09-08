# Karrierenmin — felles REST-backendkontrakt for assistentpakker

**Dette er en REST-kontrakt over HTTPS/JSON. Det er ikke MCP.** Endepunktene
implementerer ikke JSON-RPC, `tools/list` eller `tools/call`, og kan ikke
brukes som en MCP-server. Ekte MCP-transport og OAuth 2.1 er spesifisert i
`docs/operations/ai-integrations-mcp-oauth-spec.md` og er ikke bygget ennå.
Ingen av de fire pakkene er derfor installerbare i dag.

Alle fire pakkene (Grok, Claude, ChatGPT/Codex, Gemini) snakker med nøyaktig samme
backend. Ingen leverandør er standard eller anbefalt, og ingen pakke har egne
endepunkter eller egne rettigheter.

Basis-URL settes av brukeren som en offentlig HTTPS-adresse, aldri `localhost`:

```
KARRIERENMIN_BASE_URL = https://<ditt-domene>
```

## 1. Claim (engangsaktivering)

```
POST {KARRIERENMIN_BASE_URL}/api/public/ai-integrations/claim
Content-Type: application/json

{
  "provider": "grok" | "claude" | "openai" | "gemini",
  "setup_code": "XXXX-XXXX-...",
  "capabilities": {
    "background_execution": true|false,
    "scheduled_runs": true|false,
    "email_forward_or_send": true|false
  }
}
```

- `setup_code` hentes av brukeren i Karrierenmin og er gyldig i 15 minutter, én gang.
- Koden normaliseres server-side (bindestreker fjernes, versaler).
- `capabilities` **ignoreres fullstendig**. Engangskoden beviser brukerens
  samtykke og tilgang til koden, ikke hva plattformen faktisk kan gjøre. En
  uautentisert klient kan påstå hva som helst, så backend lagrer alltid tomme,
  ubekreftede egenskaper ved claim. Aldri utledet fra gratis-/betalt-abonnement.
  Egenskaper kan først settes til `true` etter en serverkontrollert
  verifisering/challenge i en senere fase.
- Alle feil svarer likt (`invalid_claim`). Backend røper aldri om koden var ukjent,
  utløpt, allerede brukt eller knyttet til en annen leverandør.

Vellykket svar inneholder `integration_token`, `token_expires_at` og
`capabilities_verified: false`. Forbindelsen er da aktiv, men ingen egenskap er
bekreftet — det er to forskjellige ting.

Tokenet lagres **ikke** automatisk. Ingen av plattformene tar imot et token fra
et verktøysvar og legger det i et secret-lager på egen hånd. Brukeren eller et
installasjonsprogram må kopiere det inn. Det skal aldri legges i prompt, logg,
README-eksempel eller URL-query.

**Koden forbrukes før aktivering.** Feiler aktivering eller tokenutstedelse
etter at koden er markert brukt, er koden likevel oppbrukt. Brukeren må lage en
ny kode i Karrierenmin. Feilmeldingen skal ikke røpe intern årsak.

**Rate-limit.** Claim begrenses per kilde-IP utledet fra `x-forwarded-for`, med
`cf-connecting-ip`/`x-real-ip` som fallback og `unknown` når ingen finnes. Det er
bare trygt når edge/proxy overskriver headeren før den når applikasjonen. Uten en
slik edge kan headeren forfalskes, og begrensningen omgås per forespørsel.
Begrensningen er dessuten per instans og i minnet, ikke distribuert.

## 2. Status

```
GET {KARRIERENMIN_BASE_URL}/api/public/ai-integrations/v1/status
Authorization: Bearer <integration_token>
```

Svarer med integrasjonens status, bekreftede capabilities, `effective_mode`
(utledet server-side) og hvilke arbeidsflyter som er tilgjengelige.

## 3. Kjøring

```
POST {KARRIERENMIN_BASE_URL}/api/public/ai-integrations/v1/run
Authorization: Bearer <integration_token>

{ "workflow_kind": "job_import" | "career_log" | "linkedin_ready" }
```

I gjeldende fase svarer backend `not_available` (HTTP 501) fordi ingen
agentutløst kjøring er koblet på ennå. Pakkene skal vise dette som det er,
og aldri fremstille det som en vellykket kjøring.

## Feilkoder

| Kode | Betydning |
| --- | --- |
| `invalid_claim` | Koden kan ikke brukes. Be brukeren lage en ny kode. |
| `rate_limited` | For mange forsøk fra samme kilde. |
| `unauthorized` | Token mangler, er feil signert, har feil audience eller er utløpt. |
| `integration_inactive` | Brukeren har koblet fra. Tilgangen er tilbakekalt. |
| `not_enabled` | Brukeren har ikke slått på arbeidsflyten. |
| `not_available` | Arbeidsflyten finnes ikke som agentutløst funksjon ennå. |
