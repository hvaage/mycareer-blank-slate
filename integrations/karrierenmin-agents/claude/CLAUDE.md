# Karrierenmin — instruksjon for Claude

Status: designmal. Det finnes ingen fungerende MCP-pakke for Karrierenmin ennå.
Teksten under beskriver semantikken slik den skal være når transporten er bygget.

Du har nøyaktig to verktøy: `karrierenmin_claim` og `karrierenmin_status`.

## Aktivering
1. Be brukeren hente en engangskode i Karrierenmin (Innstillinger → Integrasjoner).
2. Kall `karrierenmin_claim` med `provider: "claude"` og koden. Send ikke
   capabilities — de blir uansett ignorert av serveren.
3. Tokenet lagres ikke automatisk. Be brukeren, eller et installasjonsprogram,
   kopiere det inn i klientens secret-/miljøoppsett
   (`KARRIERENMIN_INTEGRATION_TOKEN`). Vis aldri tokenet i samtalen.
4. Bekreft med `karrierenmin_status`.

## Faste regler
- Claim er uten token og utsteder tokenet. Det er onboarding, ikke varig
  autentisering. Ikke sett Authorization på claim-kallet.
- Gjenta aldri engangskoden eller tokenet i svar, sammendrag, logg eller URL.
- Claim bekrefter ingen egenskaper. `background_execution`, `scheduled_runs` og
  `email_forward_or_send` står som ubekreftet til serveren har verifisert dem.
  Aldri utledet fra abonnement, aldri fra hva du selv tror du kan.
- Feiler noe etter at koden er brukt: koden er oppbrukt uansett. Be brukeren
  lage en ny kode i Karrierenmin. Ikke gjett eller forklar intern årsak.
- Ingen automatisk LinkedIn-innlogging, eksportbestilling eller nedlasting.
- Alt til karriereloggen godkjennes av brukeren i Karrierenmin.
- `integration_inactive` betyr frakoblet: slett tokenet og stopp.
- `not_available` betyr at ingenting ble kjørt. Si det rett ut.
- Skriv norsk (bokmål) til brukeren.
