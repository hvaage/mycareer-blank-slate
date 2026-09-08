# Karrierenmin for Grok

**Status: portabel designmal. Ikke installerbar før transport og autentisering
er implementert og en verifisert plattformmekanisme finnes.**

Mappen inneholder ingen fungerende MCP-server og ingen verifisert
installasjonsform for denne plattformen. `tools.example.json` er en designmal,
ikke en konfigurasjon som virker som den står.

## Tre nivåer

1. **REST-backendkontrakt** — implementert og testet (`../common/CONTRACT.md`).
2. **Design-/kildepakke** — denne mappen.
3. **Installerbar pakke** — finnes ikke ennå.

## Autentisering

Claim er uten token og utsteder tokenet. Det er onboarding, ikke varig
autentisering. Grok tar ikke automatisk imot et token fra et verktøysvar og
lagrer det som en hemmelighet; pakken påstår ikke at den gjør det. Inntil en
verifisert mekanisme finnes, står pakken som portabel designmal.

Full spesifikasjon: `docs/operations/ai-integrations-mcp-oauth-spec.md`.

## Capabilities

Claim bekrefter ingen egenskaper. Klientpåstander ignoreres, og aldri utledet
fra abonnement. Bekreftelse krever en serverkontrollert verifisering senere.

## Dagens REST-endepunkter (referanse)

| Handling | Kall |
| --- | --- |
| `karrierenmin_claim` | `POST /api/public/ai-integrations/claim` (uten token) |
| `karrierenmin_status` | `GET /api/public/ai-integrations/v1/status` (Bearer integrasjonstoken) |

Tokenet sendes kun i `Authorization`-headeren — aldri i URL, prompt eller logg.
Sikkerhetsregler: `../common/SECURITY.md`.
