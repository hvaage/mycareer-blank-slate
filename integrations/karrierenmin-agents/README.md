# Karrierenmin — assistentpakker

**Status: design-/kildepakker. Ikke installerbare før MCP-transport og
autentisering er implementert.**

Skill mellom tre nivåer, og bland dem aldri:

| Nivå | Hva det er | Status i dag |
| --- | --- | --- |
| 1. REST-backendkontrakt | `claim`, `v1/status`, `v1/run` over vanlig HTTPS/JSON | Implementert og testet |
| 2. Design-/kildepakker | Instruksjonstekst, verktøysemantikk og konfigurasjonsskisser i dette treet | Finnes her |
| 3. Installerbar MCP-/plugin-pakke | Ekte MCP-transport (JSON-RPC, `tools/list`, `tools/call`) og OAuth-basert autentisering | **Finnes ikke ennå** |

Endepunktene under `/api/public/ai-integrations/` er vanlige REST-ruter. De
implementerer ikke MCP JSON-RPC eller MCP-transport. Ingenting i dette treet er
derfor en fungerende MCP-server, og ingen av pakkene kan installeres i en
MCP-klient og virke.

Spesifikasjonen for neste leveranse ligger i
`docs/operations/ai-integrations-mcp-oauth-spec.md`.

## Kildepakke, ikke marketplace

- **Kildepakke:** alt i dette treet. Det versjoneres her.
- **Manuelt installérbart:** ingenting ennå. Tidligere formuleringer om manuell
  installasjon var feil og er fjernet.
- **Krever senere marketplace-innsending:** publisering hos en av de fire
  leverandørene. Ikke gjort. Pakkene inneholder bevisst ingen marketplace-ID,
  ingen katalogslenke og ingen påstand om tilgjengelighet.

## Claim er ikke MCP-autentisering

Claim-kallet er **uten** token og utsteder tokenet. Varig autentisering er noe
annet. Ingen av de fire plattformene tar automatisk imot et token returnert fra
et verktøykall og lagrer det som en hemmelighet. En fungerende installasjonsflyt
krever derfor enten OAuth 2.1 (ChatGPT-plugin) eller at brukeren selv kopierer
tokenet inn i klientens secret-/miljøoppsett (lokale MCP-klienter).

| Overflate | Planlagt varig autentisering |
| --- | --- |
| ChatGPT / Codex-plugin | OAuth 2.1 med PKCE, engangskode brukt inne i account linking |
| Codex / Claude lokal MCP-klient | Manuelt konfigurert secret som brukeren eller et installasjonsprogram kopierer inn |
| Gemini | Portabel designmal inntil verifisert plattformmekanisme finnes |
| Grok | Portabel designmal inntil verifisert plattformmekanisme finnes |

`common/` beskriver REST-kontrakten (`CONTRACT.md`), sikkerhetsreglene
(`SECURITY.md`), verktøysemantikken (`tools.json`) og konfigurasjonsmalen
(`config.example.json`).

## Capabilities er aldri bekreftet ved claim

Claim lagrer alltid tomme capabilities. En klientpåstand om
`background_execution`, `scheduled_runs` eller `email_forward_or_send` blir
ignorert. Egenskaper kan først bekreftes gjennom en serverkontrollert
verifisering i en senere fase.
