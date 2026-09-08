# Karrierenmin for Claude

**Status: design-/kildepakke. Ikke installerbar før transport og autentisering
er implementert.**

Mappen inneholder ingen fungerende MCP-server. `mcp.config.SKETCH.json` er
merket som ikke-fungerende skisse: Karrierenmins endepunkter er vanlige
REST-ruter uten MCP JSON-RPC, `tools/list` eller `tools/call`.

## Tre nivåer

1. **REST-backendkontrakt** — implementert og testet (`../common/CONTRACT.md`).
2. **Design-/kildepakke** — denne mappen.
3. **Installerbar MCP-pakke** — finnes ikke ennå.

## Planlagt autentisering

For en lokal MCP-klient kan et manuelt konfigurert secret brukes. Tokenet må da
kopieres inn i klientens secret-/miljøoppsett av brukeren selv eller av et
installasjonsprogram. Claude lagrer det ikke automatisk fra et verktøysvar, og
pakken påstår ikke noe annet. Claim er uten token og utsteder tokenet; det er en
onboardingflyt, ikke varig MCP-autentisering.

Full spesifikasjon: `docs/operations/ai-integrations-mcp-oauth-spec.md`.

## Capabilities

Claim bekrefter ingen egenskaper. Klientpåstander om `background_execution`,
`scheduled_runs` eller `email_forward_or_send` ignoreres, og aldri utledet fra
abonnement. De lagres som ubekreftede til en serverkontrollert verifisering har vist hva
installasjonen faktisk kan.

## Dagens REST-endepunkter (referanse, ikke MCP)

| Handling | Kall |
| --- | --- |
| `karrierenmin_claim` | `POST /api/public/ai-integrations/claim` (uten token) |
| `karrierenmin_status` | `GET /api/public/ai-integrations/v1/status` (Bearer integrasjonstoken) |

Tokenet sendes kun i `Authorization`-headeren — aldri i URL, prompt eller logg.
Sikkerhetsregler: `../common/SECURITY.md`. Verktøysemantikk: `../common/tools.json`.
