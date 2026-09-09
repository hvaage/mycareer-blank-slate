# Karrierenmin — felles backendkontrakt for assistentpakker

Kontrakten har to lag. **MCP er det kanoniske laget.** REST beholdes som
kompatibilitetslag for eksisterende integrasjonstokener, og begge lagene bruker
nøyaktig samme domenelogikk, samme autorisasjonsprinsipp og samme feilsemantikk.

Alle fem pakkene (Claude, ChatGPT/Codex, Gemini, Grok, Microsoft Copilot)
snakker med samme backend. Ingen leverandør er standard eller anbefalt, og ingen
pakke har egne endepunkter eller egne rettigheter.

Basis-URL settes av brukeren som en offentlig HTTPS-adresse, aldri `localhost`:

```
KARRIERENMIN_BASE_URL = https://<ditt-domene>
```

## 1. MCP over Streamable HTTP (kanonisk)

```
POST {KARRIERENMIN_BASE_URL}/api/public/mcp
Content-Type: application/json
Accept: application/json, text/event-stream
Authorization: Bearer <OAuth 2.1 access token>
```

- **Sesjonsløs.** Ingen sesjonsheader, ingen sesjonstabell, ingen SSE-strøm.
  Hver forespørsel autentiseres på nytt.
- **Metoder:** `initialize`, `notifications/initialized`, `ping`, `tools/list`,
  `tools/call`. `GET` og `DELETE` svarer `405` med `Allow: POST, OPTIONS`.
- **Protokollversjoner:** `2025-11-25` og `2025-06-18`. En ukjent versjon i
  `MCP-Protocol-Version` avvises med `400`. `2026-07-28` annonseres ikke, fordi
  den installerte SDK-en ikke kan validere den.
- **JSON-RPC-batch støttes ikke.** Den ble fjernet i `2025-06-18`, og begge
  støttede versjoner er uten batch.
- **Grenser:** 256 KiB body målt i UTF-8-byte, `application/json` inn,
  `no-store` ut, fremmed `Origin` avvises.
- **Feilkoder:** `-32700` parse error, `-32600` ugyldig forespørsel, `-32601`
  ukjent metode, `-32602` ugyldige parametre. En gyldig notifikasjon gir `202`
  uten innhold. `id` beholdes uendret i svaret.

### Autentisering

Uten gyldig token svarer endepunktet `401` med:

```
WWW-Authenticate: Bearer realm="karrierenmin", error="invalid_token",
  resource_metadata="{KARRIERENMIN_BASE_URL}/.well-known/oauth-protected-resource/api/public/mcp"
```

Kanonisk OAuth-`resource` er nøyaktig `{KARRIERENMIN_BASE_URL}/api/public/mcp`.
`initialize` og `tools/list` krever et gyldig token. Scope kreves per verktøy.

### Verktøy

| Verktøy | Scope | Svar |
| --- | --- | --- |
| `karrierenmin_status` | `karriere.status.read` | Status, driftsform, ubekreftede capabilities og brukerens arbeidsflytvalg |
| `karrierenmin_run` | `karriere.workflow.run` | Alltid `not_enabled` eller `not_available`. Oppretter aldri en kjøring |

Mangler tokenet scopet et verktøy krever, svarer serveren `HTTP 200` med en
MCP-verktøyfeil `insufficient_scope` — ikke `401`. Er integrasjonen frakoblet
eller revokert, avvises hele forespørselen med `401`.

## 2. Claim (engangsaktivering, kompatibilitetslag)

```
POST {KARRIERENMIN_BASE_URL}/api/public/ai-integrations/claim
Content-Type: application/json

{ "provider": "grok" | "claude" | "openai" | "gemini" | "copilot",
  "setup_code": "XXXX-XXXX-..." }
```

- `setup_code` hentes av brukeren i Karrierenmin og er gyldig i 15 minutter, én gang.
- Koden normaliseres server-side (bindestreker fjernes, versaler).
- Capabilities **ignoreres fullstendig**. Engangskoden beviser brukerens
  samtykke, ikke hva plattformen faktisk kan gjøre. Backend lagrer alltid tomme,
  ubekreftede egenskaper ved claim. Aldri utledet fra gratis-/betalt-abonnement.
- Alle feil svarer likt (`invalid_claim`). Backend røper aldri om koden var
  ukjent, utløpt, allerede brukt eller knyttet til en annen leverandør.
- **Koden forbrukes før aktivering.** Feiler noe etterpå, er koden likevel
  oppbrukt, og brukeren må lage en ny kode.
  Feilmeldingen skal ikke røpe intern årsak.
- Tokenet lagres **ikke** automatisk. Det skal aldri legges i prompt, logg,
  README-eksempel eller URL-query.

Claim er onboarding, ikke varig MCP-autentisering. Nye tilkoblinger bruker OAuth.

## 3. REST status og kjøring (kompatibilitetslag)

```
GET  {KARRIERENMIN_BASE_URL}/api/public/ai-integrations/v1/status
POST {KARRIERENMIN_BASE_URL}/api/public/ai-integrations/v1/run
Authorization: Bearer <integration_token>
```

Samme innhold og samme semantikk som MCP-verktøyene, fordi begge kaller det
samme delte domenelaget. `run` svarer `403 not_enabled` eller `501
not_available` og oppretter aldri en kjøring.

## Feilkoder

| Kode | Betydning |
| --- | --- |
| `invalid_claim` | Koden kan ikke brukes. Be brukeren lage en ny kode. |
| `rate_limited` | For mange forsøk fra samme kilde. |
| `unauthorized` / `invalid_token` | Token mangler, er feil signert, har feil audience/resource eller er utløpt. |
| `insufficient_scope` | Tilgangen mangler scopet verktøyet krever. |
| `integration_inactive` | Brukeren har koblet fra. Tilgangen er tilbakekalt. |
| `not_enabled` | Brukeren har ikke slått på arbeidsflyten. |
| `not_available` | Arbeidsflyten finnes ikke som agentutløst funksjon ennå. |
