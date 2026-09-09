# Oppgaveliste

## OAuth-herding (fra commit 461bd96d)

- [x] Migrasjon (additiv, reverserbar): `oauth_clients` med registration_method/metadata_url/expires_at/last_used_at + constraints/indexer; `ai_integrations` provider-constraint utvidet med `copilot`; oppdaterte RPC-er (v2).
- [x] Statusflyt: første vellykkede authorization_code-utveksling setter `connecting -> active` i samme transaksjon. Capabilities røres aldri. Verifisert mot database.
- [x] Preflight på signeringshemmelighet/config før kode eller refresh token konsumeres.
- [x] Gjenbruk av kode/refresh: `invalid_grant` + audit, uten bred revokering av andre grants. Verifisert mot database.
- [x] Access-tokenverifikasjon: eksakt iss/aud/resource, exp/iat/nbf med 60 sekunders klokkeskeivhet, scope, aktiv klient/grant/integrasjon, providerbinding.
- [x] Auth callback logger aldri URL, querystring, kode, state eller token. Regresjonstest.
- [x] CIMD som foretrukket klientregistrering, med hostpolicy for ChatGPT og Claude Code, sikker henting og cache/revalidering.
- [x] Claude Code-loopback kun via verifisert CIMD, med tydelig advarsel på samtykkesiden.
- [x] Herdet DCR: allowlist for eksakte callbacker, ingen generisk loopback, klientutløp og opprydding, databasestøttet ratebegrensning.
- [x] Microsoft Copilot som femte likestilte assistent i kontrakter, validering, UI/onboarding, database, dokumentasjon og kildepakke.
- [x] Tester: rute-/kontraktstester (24 filer / 358 tester), DB-tester for v2-RPC-ene, RLS/ACL, statusovergang, capability-uforanderlighet, samtidighet/replay, DCR allow/deny, klientutløp og opprydding.
- [x] Dokumentasjon: CIMD først, DCR som fallback, faktiske begrensninger.
- [x] Full testsuite, typecheck, lint, build og security-advisor (118 funn = uendret baseline). Ingen publisering.

## Åpne punkter (blokkert / ikke gjort)

- [ ] Performance Advisor som eget verktøy er ikke tilgjengelig i dette miljøet. Erstattet med manuell indekskontroll: manglende indekser på fremmednøkler i OAuth-tabellene ble lagt til i migrasjon `20260909143412_...`.
- [ ] Streamable HTTP MCP-transport (`karrierenmin_status` / `karrierenmin_run`) er ikke implementert.
- [ ] Live E2E mot ChatGPT/Claude/Copilot/Grok/Gemini: IKKE KJØRT. Krever ekte konto og installasjon hos leverandør.
- [ ] Migrasjonskravet «én ny migrasjon» ble i praksis fire filer: hovedherding (`20260909141023_...`), retting av tvetydig `family_id` (`20260909142117_...`) og indeksering (`20260909143412_...`), i tillegg til fase 3-basen. Alle er additive.
