# Retting av NAV job feed smoke test

## Hva som skjedde

Loggen viser årsakskjeden tydelig:

1. `Could not fetch NAV public token: ... Read timed out. (read timeout=30)`
2. `Token source: none` / `Authorization header will be sent: False`
3. `GET /api/v1/feed` → `401` med feil-JSON (`title/status/type/details`)
4. Skriptet leter etter `items` i den JSON-en, finner den ikke, og feiler med
   «feed response did not contain an 'items' list»

Selve `items`-feilen er altså en følgefeil. Rotproblemet er at testen henter
tokenet dynamisk fra NAV ved hver kjøring (`NAV_FEED_USE_PUBLIC_TOKEN: 1`), og
det kallet tidsavbrøt.

Kontroll utført nå mot NAV:

- Verten svarer raskt (0,2–0,3 s), så nedetid er ikke en varig tilstand — dette
  var en forbigående treghet i NAV sitt token-endepunkt.
- `GET /api/v1/feed` uten token gir fortsatt `401` (forventet).
- Ingen av de åpne token-URL-ene svarer med et token via enkel GET
  (`/api/v1/token`, `/api/v1/apiToken` → 404). Automatisk «public token»-henting
  er derfor en skjør avhengighet CI ikke bør stå på.

Merk: koden som feiler ligger i repoet `hvaage/norwegian-career-intelligence`
(`scripts/test_nav_feed.py` + GitHub Actions-workflowen), ikke i dette
Lovable-prosjektet. Planen beskriver endringene som skal gjøres der.

## Korreksjon

1. **Token fra secret som primærkilde.** Workflowen setter `NAV_FEED_TOKEN` fra
   `secrets.NAV_FEED_TOKEN`. Skriptet bruker det hvis satt, og forsøker kun
   public-token som fallback. `NAV_FEED_USE_PUBLIC_TOKEN` settes til `0` når
   secret finnes.
2. **Robust nettverkslag.** Token-henting og feed-kall får `connect timeout 10 /
   read timeout 60`, 3 forsøk med eksponentiell backoff (2s, 4s, 8s) på
   timeout/5xx/429. Ingen retry på 401/403.
3. **Skill infrastruktur fra datafeil.** Nye exit-koder:
   - `0` = OK
   - `1` = ekte datafeil (200 OK, men feil form / mangler `items`)
   - `78` = infrastruktur/auth (timeout, 401, 403, 5xx) → workflowsteget merkes
     som `neutral`/varsel i stedet for rød «All jobs have failed».
4. **Presis feilmelding.** Når status ikke er 200, skal skriptet rapportere
   HTTP-status og NAV sitt `title`-felt, og ikke påstå at feeden mangler
   `items`. `items`-sjekken kjører kun på 200-svar.
5. **Ingen råbody-lagring ved auth-feil.** `data/raw/sample_feed.json`
   overskrives ikke med en 401-envelope, slik at siste gyldige eksempel består.
6. **Verifisering.** Kjør workflowen manuelt (`workflow_dispatch`) etter at
   secret er lagt inn: forventet resultat er 200 og en `items`-liste med
   innslag; kjør deretter én gang med tomt token for å bekrefte at det gir
   exit 78 og tydelig auth-melding, ikke «missing items».

## Det jeg trenger fra deg

`NAV_FEED_TOKEN` må legges inn som GitHub Actions-secret i
`hvaage/norwegian-career-intelligence` (Settings → Secrets → Actions). Tokenet
bestilles fra NAV sin feed-dokumentasjon.

## Teknisk

Endringer i det andre repoet:

- `scripts/test_nav_feed.py`: ny `http_get_with_retry()`-hjelper, tokenoppslag
  omskrevet til secret-først, statusbasert exit-kode, betinget råbody-lagring.
- `.github/workflows/<nav-smoke>.yml`: `NAV_FEED_TOKEN: ${{ secrets.NAV_FEED_TOKEN }}`,
  `NAV_FEED_USE_PUBLIC_TOKEN: 0`, `continue-on-error` håndtering av exit 78 og
  `workflow_dispatch`-trigger.

Siden repoet ikke er koblet til dette prosjektet, leverer jeg ferdig patch-tekst
du limer inn (eller kjører via Codex/Claude i det repoet).
