# Privat ChatGPT-kobling (connector) — sjekkliste

Arkitekturen er fast: **all jobbtolkning, matching og relevansvurdering skjer i
Karrierenmin.** ChatGPT er kun en autentisert klient som kaller backend og viser
svarene ordrett. Koblingen inneholder ingen scoringslogikk.

## A. Levert i kode (ingenting mer å bygge)

| Del | Adresse | Fil |
| --- | --- | --- |
| MCP-endepunkt (Streamable HTTP) | `POST https://karrierenmin.no/mcp` | `src/routes/mcp/index.ts` |
| Kanonisk MCP-endepunkt | `POST /api/public/mcp` | `src/routes/api/public/mcp.ts` |
| Pakkemetadata for koblingen | `GET /.well-known/ai-plugin.json` | `src/lib/ai-integrations/connector-manifest.server.ts` |
| Autorisasjonsservermetadata | `GET /.well-known/oauth-authorization-server` | `src/routes/[.]well-known/oauth-authorization-server.ts` |
| Ressursmetadata (begge stier) | `GET /.well-known/oauth-protected-resource/mcp` m.fl. | `src/lib/ai-integrations/oauth-resource-metadata.server.ts` |
| Logo | `GET /icon-512.png` | `public/icon-512.png` |
| Verktøy | `karrierenmin_status`, `karrierenmin_run` | `src/lib/ai-integrations/mcp-server.server.ts` |

`karrierenmin_run` starter aldri en arbeidsflyt; den rapporterer kun tilstand.

Forutsetning i drift: `PUBLIC_APP_ORIGIN` må være satt til `https://karrierenmin.no`.
Uten den svarer metadata- og MCP-rutene 500.

## B. Manuelle steg i ChatGPTs private katalog (ikke kode)

1. Logg inn i arbeidsområdet som eier/administrator.
2. Velg **Settings → Connectors → Create/Add custom connector** (privat, ikke publisert).
3. Server-URL: `https://karrierenmin.no/mcp`.
4. Autentisering: **OAuth**. ChatGPT oppdager endepunktene selv gjennom
   `WWW-Authenticate` og metadata-dokumentene; ingen klienthemmelighet skal limes inn.
5. Klient-ID er ChatGPTs eget CIMD-dokument
   (`https://chatgpt.com/oauth/client.json`, Codex: `.../oauth/codex/client.json`).
   Begge er allerede tillatt i klientpolicyen.
6. Scopes: `karriere.status.read karriere.workflow.run`.
7. Trykk **Authenticate**, logg inn med Karrierenmin-kontoen og godkjenn.
8. Bekreft at `karrierenmin_status` vises i verktøylisten.
9. Del koblingen kun med de brukerne som skal ha den. Ikke publiser den offentlig.

## C. Verifikasjon

- `curl -s https://karrierenmin.no/.well-known/ai-plugin.json` → 200 med riktig `api.url`.
- `curl -i -X POST https://karrierenmin.no/mcp` uten token → 401 med `WWW-Authenticate`.
- Etter innlogging: `tools/list` returnerer begge verktøyene.
