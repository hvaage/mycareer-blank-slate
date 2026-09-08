# Karrierenmin — assistentpakker

Fire likestilte kildepakker mot samme backendkontrakt. Ingen av dem er standard
eller anbefalt, og de har identiske rettigheter.

| Mappe | Plattform | Installasjonsform per september 2026 |
| --- | --- | --- |
| `openai/` | ChatGPT / Codex | MCP-server-konfigurasjon med autentiserte verktøy, supplert av en instruksjonsfil |
| `claude/` | Claude | Portabel instruksjonspakke (`CLAUDE.md`-stil) + MCP-konfigurasjonsmal |
| `gemini/` | Gemini | Portabel instruksjonspakke + verktøymal |
| `grok/` | Grok | Portabel instruksjonspakke + verktøymal |

`common/` beskriver backendkontrakten (`CONTRACT.md`), sikkerhetsreglene
(`SECURITY.md`), felles verktøysemantikk (`tools.json`) og konfigurasjonsmal
(`config.example.json`).

## Hva dette er, og hva det ikke er

- **Kildepakke:** alt i dette treet. Det ligger i repoet og versjoneres her.
- **Manuelt installérbart:** alle fire pakkene kan brukes i dag ved at brukeren
  selv legger instruksjonsfilen og konfigurasjonen inn i sin egen assistent.
- **Krever senere marketplace-innsending:** publisering i en offisiell katalog
  hos noen av de fire leverandørene. Dette er ikke gjort, og pakkene inneholder
  bevisst ingen marketplace-ID, ingen katalogslenke og ingen påstand om at de
  er tilgjengelige der.

Der et stabilt, dokumentert marketplace-format ikke kunne bekreftes, er pakken
holdt konservativ og portabel med vilje.

## Brukerflyt (identisk for alle fire)

1. Installer pakken i din assistent etter pakkens README.
2. Sett `KARRIERENMIN_BASE_URL` til den offentlige HTTPS-adressen.
3. Hent en engangskode i Karrierenmin under Innstillinger → Integrasjoner.
4. Kjør `karrierenmin_claim` én gang med koden.
5. Lagre `integration_token` i plattformens sikre secret-lager.
6. Kjør `karrierenmin_status` for å bekrefte at aktiveringen virker.
