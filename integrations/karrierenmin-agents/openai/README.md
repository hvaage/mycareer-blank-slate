# Karrierenmin for ChatGPT / Codex

**Status: design-/kildepakke. Ikke installerbar før transport og autentisering
er implementert.**

Denne mappen inneholder ingen fungerende MCP-server og ingen fungerende plugin.
`mcp.config.SKETCH.json` er merket som ikke-fungerende skisse fordi
Karrierenmins nåværende endepunkter er vanlige REST-ruter uten MCP JSON-RPC,
`tools/list` eller `tools/call`.

## Tre nivåer

1. **REST-backendkontrakt** — implementert og testet (`../common/CONTRACT.md`).
2. **Design-/kildepakke** — denne mappen.
3. **Installerbar MCP/plugin** — finnes ikke ennå.

## Planlagt autentisering

ChatGPT-plugin skal følge den offisielle OAuth 2.1-kontrakten for MCP:
discovery, authorization endpoint, token endpoint, PKCE og state. Engangskoden
fra Karrierenmin brukes **inne i** autorisasjons-/account-linking-flyten.
ChatGPT skal ikke måtte ta imot et bearer-token fra et verktøysvar og lagre det
som en hemmelighet — det er ikke en støttet mekanisme og beskrives derfor ikke
som en installasjonsflyt.

Full spesifikasjon: `docs/operations/ai-integrations-mcp-oauth-spec.md`.

## Capabilities

Claim bekrefter ingen egenskaper. `background_execution`, `scheduled_runs` og
`email_forward_or_send` lagres alltid som ubekreftede ved claim, uansett hva
klienten påstår og uansett abonnement. Bekreftelse krever en serverkontrollert
verifisering i en senere fase.

## Dagens REST-endepunkter (referanse, ikke MCP)

| Handling | Kall |
| --- | --- |
| `karrierenmin_claim` | `POST /api/public/ai-integrations/claim` (uten token) |
| `karrierenmin_status` | `GET /api/public/ai-integrations/v1/status` (Bearer integrasjonstoken) |

Tokenet sendes kun i `Authorization`-headeren — aldri i URL, prompt eller logg.
`INSTRUCTIONS.md` er bruksregler, ikke en sikkerhetsmekanisme, og skal aldri
være eneste kontroll.
