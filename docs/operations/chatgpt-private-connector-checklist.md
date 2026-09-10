# Privat ChatGPT-connector mot Karrierenmin

## Mekanisme

Moderne private ChatGPT-connectors opprettes **manuelt** i ChatGPT ved å peke på
en MCP-server-URL med OAuth. Det finnes ingen manifestfil som ChatGPT laster
ned for dette. Et gammelt `/.well-known/ai-plugin.json`-manifest med
`api.type = "mcp"` hører til den avviklede plugin-mekanismen og skal **ikke**
publiseres — det finnes ikke i kodebasen, og skal ikke gjeninnføres.

## Levert i kode

| Del | Adresse |
| --- | --- |
| MCP Streamable HTTP (alias) | `https://karrierenmin.no/mcp` |
| MCP Streamable HTTP (kanonisk) | `https://karrierenmin.no/api/public/mcp` |
| Protected resource metadata | `/.well-known/oauth-protected-resource/mcp` og `/mcp/.well-known/oauth-protected-resource` |
| Authorization server metadata | `/.well-known/oauth-authorization-server` |
| OAuth 2.1 + PKCE, CIMD, DCR | authorize / token / revoke / register |
| Verktøy | `karrierenmin_status`, `karrierenmin_run` |

Scopes: `karriere.status.read`, `karriere.workflow.run`.
Resource-binding: `https://karrierenmin.no/mcp` eller kanonisk URL — token må
være utstedt for nøyaktig den resource-en klienten kaller.

## Manuelle steg i ChatGPT (ikke kode)

1. ChatGPT → Settings → Connectors → Create (krever arbeidsområde med
   connector-tilgang).
2. MCP server URL: `https://karrierenmin.no/mcp`.
3. Autentisering: OAuth. ChatGPT henter discovery-metadataene selv; ingen
   client-id skal limes inn manuelt (CIMD brukes).
4. Godkjenn i Karrierenmin-innloggingen som åpnes, og velg scopes.
5. Verifiser at `karrierenmin_status` listes og svarer.

## Arkitektur — uendret

Parsing, matching og relevansvurdering skjer utelukkende i Karrierenmin-backend.
ChatGPT er kun en autentisert klient som viser backendens autoritative svar.
`karrierenmin_run` starter aldri en arbeidsflyt og skal aldri påstå det.

## Forutsetninger

- `PUBLIC_APP_ORIGIN = https://karrierenmin.no`
- `AI_INTEGRATION_OAUTH_SECRET` satt
- Siste versjon publisert

## Status

Live ende-til-ende-test mot ChatGPT: ikke kjørt i denne leveransen.
