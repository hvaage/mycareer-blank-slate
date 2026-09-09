# Karrierenmin for Grok

**Status: MCP-serveren er bygget og testet. Installasjon hos Grok er ikke
verifisert ende-til-ende — ingen live-test er kjørt mot leverandøren.**

Karrierenmin eksponerer én leverandørnøytral MCP-server over Streamable HTTP:

```
POST https://REPLACE-WITH-YOUR-PUBLIC-HOST/api/public/mcp
```

Alle fem assistentene (Claude, ChatGPT/Codex, Gemini, Grok, Microsoft Copilot)
bruker nøyaktig samme endepunkt, samme to verktøy og samme rettigheter. Ingen
leverandør er standard, anbefalt eller privilegert.

## Verktøy

| Verktøy | Scope | Hva det gjør |
| --- | --- | --- |
| `karrierenmin_status` | `karriere.status.read` | Status, driftsform, bekreftede egenskaper og hvilke arbeidsflyter brukeren har slått på |
| `karrierenmin_run` | `karriere.workflow.run` | Ber om en arbeidsflyt. Svarer alltid `not_enabled` eller `not_available` og oppretter aldri en kjøring |

Ingen arbeidsflyt kan startes av en assistent i dag. Presenter aldri et
`karrierenmin_run`-svar som en utført jobb.

## Autentisering

MCP-serveren bruker OAuth 2.1 med PKCE. Klienten oppdager autorisasjonsserveren
fra `401`-svaret og
`https://REPLACE-WITH-YOUR-PUBLIC-HOST/.well-known/oauth-protected-resource/api/public/mcp`.
Brukeren logger inn i Karrierenmin og godkjenner scopene selv. Ingen statisk
nøkkel legges i konfigurasjonen. Se `mcp.config.json`.

Tokenet skal aldri stå i prompt, samtalelogg, feilmelding eller URL — kun i
`Authorization`-headeren, som klienten setter selv.

## Kompatibilitetslag (REST, ikke MCP)

De eldre REST-rutene beholdes for eksisterende integrasjonstokener og bruker
samme domenelag som MCP:

| Handling | Kall |
| --- | --- |
| `karrierenmin_claim` | `POST /api/public/ai-integrations/claim` (uten token) |
| `karrierenmin_status` | `GET /api/public/ai-integrations/v1/status` (Bearer integrasjonstoken) |

Nye installasjoner bør bruke MCP og OAuth, ikke engangskode.

## Capabilities

Capabilities bekreftes aldri av claim, og aldri av abonnement. En klientpåstand
ignoreres, og egenskapene står som ubekreftede til en serverkontrollert
verifisering har vist hva installasjonen faktisk kan.

## Sikkerhet

Ingen automatisk LinkedIn-innlogging, bestilling eller nedlasting. LinkedIn-data
kommer kun fra brukerens egen offisielle ZIP-eksport. Felles regler:
`../common/SECURITY.md`. Verktøysemantikk: `../common/tools.json`.
