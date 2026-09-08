# Karrierenmin for Claude

**Pakketype:** kildepakke. Portabel instruksjonspakke + MCP-konfigurasjonsmal.
**Status:** manuelt installérbar i dag. Ikke innsendt til noen offisiell katalog.

Et stabilt marketplace-format for denne plattformen kunne ikke bekreftes ved
utarbeidelsen, og pakken er derfor bevisst konservativ og portabel.

## Installasjon

1. Legg innholdet i `CLAUDE.md` inn som prosjektinstruksjon.
2. Kopier `mcp.config.example.json` inn i din MCP-konfigurasjon og bytt
   `https://REPLACE-WITH-YOUR-PUBLIC-HOST` til den offentlige HTTPS-adressen.
   Ikke bruk `localhost`.
3. Legg `KARRIERENMIN_INTEGRATION_TOKEN` i plattformens secret-lager.

## Første gang

Hent engangskode i Karrierenmin, kjør `karrierenmin_claim` én gang, lagre
`integration_token` sikkert, og bekreft med `karrierenmin_status`.

Verktøysemantikk: `../common/tools.json`. Sikkerhetsregler: `../common/SECURITY.md`.
