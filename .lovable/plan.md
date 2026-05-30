## Secrets som skal legges til

Tre secrets gjenstår:

| Secret | Hvor du henter den |
|---|---|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys — brukes til CV-parsing, søknadsgenerering og selskapsanalyse |
| `CAREERJET_AFFID` | https://www.careerjet.com/partners/ — registrer deg som partner og hent `affid` |
| `SITE_URL` | Ingen ekstern lenke — sett verdien til `https://karrierenmin.no` (brukes som User-Agent mot Careerjet) |

`MARKET_SUPABASE_URL` droppes — klienten har URL-en som fallback i koden.

## Neste steg

Når du bytter til build-modus åpner jeg secret-skjemaet for de tre over samtidig, så fyller du inn verdiene i ett steg.