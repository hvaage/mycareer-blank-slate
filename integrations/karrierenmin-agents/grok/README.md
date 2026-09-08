# Karrierenmin for Grok

**Pakketype:** kildepakke. Portabel instruksjonspakke + verktøymal.
**Status:** manuelt installérbar i dag. Ikke innsendt til noen offisiell katalog.

Et stabilt marketplace-format for denne plattformen kunne ikke bekreftes ved
utarbeidelsen, og pakken er derfor bevisst konservativ og portabel.

## Installasjon

1. Legg innholdet i `INSTRUCTIONS.md` inn som system-/agentinstruksjon.
2. Registrer verktøyene fra `tools.example.json`, og bytt
   `https://REPLACE-WITH-YOUR-PUBLIC-HOST` til den offentlige HTTPS-adressen.
   Ikke bruk en lokal utvikleradresse.
3. Legg `KARRIERENMIN_INTEGRATION_TOKEN` i plattformens secret-lager dersom det
   finnes. Har plattformen ikke et sikkert lager, må brukeren selv velge trygg
   lagring — pakken later ikke som noe annet.

## Første gang

Hent engangskode i Karrierenmin, kjør `karrierenmin_claim` én gang, lagre
`integration_token` sikkert, og bekreft med `karrierenmin_status`.

Verktøysemantikk: `../common/tools.json`. Sikkerhetsregler: `../common/SECURITY.md`.

## Endepunkter

| Verktøy | Kall |
| --- | --- |
| `karrierenmin_claim` | `POST /api/public/ai-integrations/claim` (uten token) |
| `karrierenmin_status` | `GET /api/public/ai-integrations/v1/status` (Bearer integrasjonstoken) |

Tokenet sendes kun i `Authorization`-headeren — aldri i URL, prompt eller logg.
