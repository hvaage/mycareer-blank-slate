# Oppgaveliste

## OAuth-herding (fra commit 461bd96d)

- [ ] Migrasjon (additiv, reverserbar): `oauth_clients` med registration_method/metadata_url/expires_at/last_used_at + constraints/indexer; `ai_integrations` provider-constraint utvidet med `copilot`; oppdaterte RPC-er.
- [ ] Statusflyt: første vellykkede authorization_code-utveksling setter `connecting -> active` i samme transaksjon. Capabilities røres aldri.
- [ ] Preflight på signeringshemmelighet/config før kode eller refresh token konsumeres.
- [ ] Gjenbruk av kode/refresh: `invalid_grant` + audit, uten bred revokering av andre grants.
- [ ] Access-tokenverifikasjon: eksakt iss/aud/resource, exp/iat/nbf med dokumentert klokkeskeivhet, scope, aktiv klient/grant/integrasjon, providerbinding.
- [ ] Auth callback logger aldri URL, querystring, kode, state eller token. Regresjonstest.
- [ ] CIMD som foretrukket klientregistrering, med hostpolicy for ChatGPT og Claude Code, sikker henting og cache/revalidering.
- [ ] Claude Code-loopback kun via verifisert CIMD, med tydelig advarsel på samtykkesiden.
- [ ] Herdet DCR: allowlist for eksakte callbacker, ingen loopback, klientutløp og opprydding, databasestøttet ratebegrensning.
- [ ] Microsoft Copilot som femte likestilte assistent i kontrakter, validering, UI/onboarding, database, dokumentasjon og kildepakke.
- [ ] Tester: rute-/integrasjonstester, DB-tester for RPC-er, RLS/ACL, statusovergang, capability-uforanderlighet, concurrency/replay, DCR allow/deny, klientutløp.
- [ ] Dokumentasjon: CIMD først, DCR som fallback, faktiske begrensninger.
- [ ] Full testsuite, typecheck, lint, build, security- og performance-advisors. Ingen publisering.
