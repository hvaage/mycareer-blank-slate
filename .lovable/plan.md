# MCP-discovery: gjeninnfør korrekte outputSchema + svar på ressursmetodene

## Hva bevisene viser

1. **Discovery-avvisningen i produksjonsloggen** (10.09. kl. 12:25:07–12:25:09 UTC) er
   `resources/templates/list` og `resources/list` som får JSON-RPC `-32601 Method not found`.
   Dette skjer etter vellykket `initialize` og `tools/list`.
2. **`outputSchema` var ikke i seg selv feil.** OpenAIs plugin-dokumentasjon ber uttrykkelig om
   `outputSchema` for verktøy som returnerer strukturert data. Fjerningen i `f583fad5` var en
   hypotese uten bevis og skal reverseres.
3. **Men de gamle skjemaene var faktisk inkonsistente med svarene.** I
   `mcp-server.server.ts` returnerer `toolError()` alltid
   `structuredContent: { ok: false, error: { code, message } }`. Det bryter begge skjemaer:
   - `karrierenmin_status`: skjemaet krever `api_version`, `integration`, `workflows` og har
     `additionalProperties: false` — et feilobjekt validerer aldri.
   - `karrierenmin_run`: skjemaet krever `ok`, `workflow_kind`, `error` — feilveiene for
     manglende scope og inaktiv integrasjon mangler `workflow_kind`.
   En klient som validerer `structuredContent` mot `outputSchema` vil derfor avvise feilsvar.

## Plan

### 1. Ressursmetodene (den dokumenterte discovery-feilen)
- Annonsér `resources: { listChanged: false }` i `initialize`-capabilities.
- Implementér `resources/list` → `{ "resources": [] }` og
  `resources/templates/list` → `{ "resourceTemplates": [] }`, med samme parametervalidering
  som øvrige metoder. Sannferdig: vi eksponerer ingen ressurser.
- Ingen endring i `karrierenmin_status`/`karrierenmin_run`-semantikk; `karrierenmin_run`
  starter fortsatt aldri en kjøring.

### 2. Gjeninnfør `outputSchema` — konsistent denne gangen
- Legg tilbake begge `outputSchema`-blokkene fra `1efd41e7`.
- Rett feilveiene slik at `structuredContent` alltid validerer:
  - Protokoll-/tilgangsfeil (`insufficient_scope`, `integration_inactive`) returnerer
    `isError: true` med tekstinnhold og **uten** `structuredContent`. MCP krever bare
    validering når `structuredContent` er til stede.
  - `karrierenmin_run` sitt normale «ikke tilgjengelig»-svar beholder `structuredContent`
    og skal alltid inneholde `ok: false`, `workflow_kind` og `error`.
- Fjern kommentaren i `mcp-contract.ts` som begrunner fraværet av `outputSchema`, og erstatt
  den med begrunnelsen over.

### 3. Verifisering
- Utvid HTTP-regresjonstesten med den observerte ChatGPT-sekvensen:
  `initialize` → `notifications/initialized` → `tools/list` → `resources/list` →
  `resources/templates/list`, for begge protokollversjoner.
- Ny test: hvert `structuredContent` fra verktøykall (både ok og feil) valideres mot
  verktøyets `outputSchema`, slik at inkonsistensen ikke kan gjeninnføres.
- Valider alle resultater mot SDK-skjemaene.
- Kjør full testpakke, typecheck, lint og build.

### Berørte filer
- `src/lib/ai-integrations/mcp-contract.ts`
- `src/lib/ai-integrations/mcp-server.server.ts`
- `src/lib/__tests__/ai-integrations-mcp-discovery.test.ts`
- `src/lib/__tests__/ai-integrations-mcp.test.ts`

Ingen database-, migrasjons- eller konfigurasjonsendring. Publisering gjøres av Henrik etterpå.
