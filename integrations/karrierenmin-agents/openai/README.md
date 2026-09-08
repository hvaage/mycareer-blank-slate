# Karrierenmin for ChatGPT / Codex

**Pakketype:** kildepakke. MCP-serverkonfigurasjon + supplerende instruksjonsfil.
**Status:** manuelt installérbar i dag. Ikke innsendt til noen offisiell katalog.

OpenAIs gjeldende offisielle kontrakt krever at kundespesifikke data og
skrivehandlinger er autentisert. Derfor er MCP-verktøyene den bærende
sikkerhetsmekanismen her: alle kall mot Karrierenmin går gjennom autentiserte
verktøy med `Authorization: Bearer <integration_token>`. `INSTRUCTIONS.md`
supplerer verktøyene med bruksregler, men er **ikke** en sikkerhetsmekanisme og
skal aldri være eneste kontroll.

## Installasjon

1. Kopier `mcp.config.example.json` inn i din MCP-klientkonfigurasjon.
2. Erstatt `https://REPLACE-WITH-YOUR-PUBLIC-HOST` med den offentlige
   HTTPS-adressen til Karrierenmin. Ikke bruk `localhost`.
3. Legg `KARRIERENMIN_INTEGRATION_TOKEN` i klientens secret-lager. Ikke i filen,
   ikke i git, ikke i prompt.
4. Legg innholdet i `INSTRUCTIONS.md` inn som prosjekt-/agentinstruksjon.

## Første gang

Kjør verktøyet `karrierenmin_claim` med engangskoden fra Karrierenmin. Lagre
`integration_token` i secret-lageret, og bekreft med `karrierenmin_status`.

Verktøysemantikken er identisk med `../common/tools.json`. Sikkerhetsreglene i
`../common/SECURITY.md` gjelder uendret.
