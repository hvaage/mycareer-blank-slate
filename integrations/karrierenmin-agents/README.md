# Karrierenmin — assistentpakker

**Status: MCP-serveren er bygget og testet. Den er leverandørnøytral og lik for
alle fem assistentene. Live installasjon hos den enkelte leverandøren er IKKE
verifisert — ingen ende-til-ende-test er kjørt mot ChatGPT/Codex, Claude,
Gemini, Grok eller Microsoft Copilot.**

| Nivå | Hva det er | Status i dag |
| --- | --- | --- |
| 1. MCP-transport | Streamable HTTP JSON-RPC på `POST /api/public/mcp` med `initialize`, `tools/list`, `tools/call` | Implementert og testet |
| 2. OAuth 2.1 | PKCE, discovery, samtykke, token, revokering, scope per verktøy | Implementert og testet |
| 3. REST-kompatibilitetslag | `claim`, `v1/status`, `v1/run` for eksisterende integrasjonstokener | Beholdt, samme domenelag |
| 4. Verifisert installasjon hos leverandør | Live oppkobling i den enkelte klienten | **Ikke kjørt** |

Alle fem pakkene peker på nøyaktig samme endepunkt, samme to verktøy og samme
scopes. Ingen leverandør har egne verktøy, egne felter eller egne rettigheter.

## Kildepakke, ikke marketplace

- **Kildepakke:** alt i dette treet. Det versjoneres her.
- **Leverandørnøytralt manifest:** `common/connection.json` beskriver endepunkt,
  resource, scopes og verktøy. Det er dokumentasjon — ingen klient kan importere
  den filen.
- **Konfigurasjonsfil finnes bare der formatet er dokumentert:** `claude/mcp.json`
  (Claude Code, lagres som `.mcp.json`) og `gemini/settings.example.json`
  (Gemini CLI, feltet `httpUrl`). Ingen av dem er verifisert ende-til-ende hos leverandøren, og de er derfor
  ikke verifisert som installasjon.
- **Installasjon i grensesnitt, ikke fil:** ChatGPT/Codex (koblinger/utviklermodus),
  Microsoft Copilot Studio (MCP-veiviser) og Grok (ingen dokumentert filformat vi
  har verifisert) settes opp med server-URL i klientens eget grensesnitt.

- **Krever senere marketplace-innsending:** publisering hos leverandørene. Ikke
  gjort. Pakkene inneholder bevisst ingen marketplace-ID, ingen katalogslenke og
  ingen påstand om tilgjengelighet.

## Verktøy

| Verktøy | Scope | Semantikk |
| --- | --- | --- |
| `karrierenmin_status` | `karriere.status.read` | Leser status, driftsform og brukerens egne arbeidsflytvalg |
| `karrierenmin_run` | `karriere.workflow.run` | Ber om en arbeidsflyt. Svarer alltid `not_enabled` eller `not_available`, og oppretter aldri en kjøring |

## Autentisering

MCP-serveren er en OAuth 2.1-beskyttet ressurs. Kanonisk `resource` er nøyaktig
`https://<ditt-domene>/api/public/mcp`. Klienten oppdager autorisasjonsserveren
via `401` + `WWW-Authenticate` og
`/.well-known/oauth-protected-resource/api/public/mcp`.

Claim-kallet i REST-laget er noe annet: det er uten token og utsteder tokenet.
Det er onboarding, ikke varig MCP-autentisering, og det er ikke lenger den
anbefalte veien inn.

## Capabilities er aldri bekreftet ved claim

Claim lagrer alltid tomme capabilities. En klientpåstand om
`background_execution`, `scheduled_runs` eller `email_forward_or_send` blir
ignorert. Egenskaper kan først bekreftes gjennom en serverkontrollert
verifisering i en senere fase.

`common/` beskriver kontrakten (`CONTRACT.md`), sikkerhetsreglene
(`SECURITY.md`), verktøysemantikken (`tools.json`) og konfigurasjonsmalen
(`config.example.json`).
