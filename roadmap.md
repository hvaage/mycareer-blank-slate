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

## Korreksjonsrunde (fra commit e49e8cf2)

- [x] Claude Code-loopback følger nå den offisielle modellen: portløs metadata-mal (`http://localhost/callback`, `http://127.0.0.1/callback`) valideres separat fra faktisk authorize-redirect med ephemeral port 1024–65535. Portagnostisk match kun for `registration_method=cimd` med client_id/metadata_url = `https://claude.ai/oauth/claude-code-client-metadata`. DCR, manual og andre CIMD-klienter har fortsatt eksakt match. Tester dekker begge retninger.
- [x] Ressursbinding er obligatorisk: `oauth_authorization_codes.resource` er NOT NULL etter trygg fjerning av gamle NULL-koder (60 sek TTL), og RPC-en avviser NULL, tom og avvikende ressurs (`IS DISTINCT FROM`). Verifisert mot database.
- [x] DCR: opportunistisk `oauth_cleanup_expired_clients` før registrering, fail closed. Bodygrensen måles som UTF-8-byte, og for stor `Content-Length` avvises før body leses. Tester med multibyte.
- [x] Minste rettigheter på `oauth_security_events`: kun `service_role` med SELECT/INSERT/DELETE. Eier (`postgres`) og plattformrollen `sandbox_exec` (SELECT/INSERT) er plattforminterne og urørt. Tabellkommentaren er rettet: ingen tokener/koder/hemmeligheter, `user_id` er pseudonym med definert opprydding.
- [x] Rene formatteringsendringer i urelaterte CV-testfiler er tilbakestilt. Testlogikk uendret.
- [x] Full suite (24 filer / 365 tester), typecheck, lint og security advisor (118 funn = uendret baseline).

## Streamable HTTP MCP-transport (fra commit f3e5feb0)

- [x] Ett leverandørnøytralt endepunkt: `POST /api/public/mcp`. Sesjonsløst — ingen sesjonsheader, ingen sesjonstabell, ingen SSE-strøm.
- [x] `@modelcontextprotocol/sdk@1.30.0` installert og brukt som referanse for typer/skjemaer/protokollkonstanter. HTTP-laget er egen sesjonsløs adapter fordi SDK-transporten ikke kan gi de påkrevde svarene (405 med `Allow: POST, OPTIONS`, OAuth-`WWW-Authenticate` før meldingen tolkes, scope per verktøy). Begrunnelsen er dokumentert i koden og i spesifikasjonen.
- [x] Protokollversjoner 2025-06-18 og 2025-11-25 med versjonsstyrt batch-regel (ingen støttet versjon tillater batch). 2026-07-28 annonseres bevisst ikke — SDK-en kan ikke validere den.
- [x] HTTP-semantikk: GET/DELETE 405 med `Allow: POST, OPTIONS`, OPTIONS 204, notifikasjon 202, `-32601`, `-32602`, `-32700`, `-32600`, `id` beholdt.
- [x] Herding: `application/json` inn, Accept-krav, 256 KiB UTF-8-bodygrense (både `Content-Length` og faktiske byte), Origin/DNS-rebinding, CORS kun for egen origin, `no-store`, ingen logging.
- [x] Autentisering før tolkning. 401 med eksakt `WWW-Authenticate` og `resource_metadata`. Kanonisk OAuth-resource er nøyaktig `/api/public/mcp`, med ny ressursspesifikk discovery-rute.
- [x] Scope per verktøy: manglende verktøy-scope gir HTTP 200 med MCP-feil `insufficient_scope`; frakoblet/revokert integrasjon gir 401.
- [x] `karrierenmin_status` og `karrierenmin_run` med eksakte input-/outputskjemaer, annotations og strukturert output. `run` returnerer kun `not_enabled`/`not_available` og oppretter aldri en kjøring.
- [x] Delt domenelag (`agent-domain.server.ts`) brukt av både MCP og REST-kompatibilitetsrutene. Ingen claim-verktøy over MCP.
- [x] Kontrakter, alle fem leverandørpakker, MCP/OAuth-spesifikasjon og E2E-plan oppdatert. Ingen migrasjon var nødvendig.
- [x] Tester: 43 MCP-tester (handler, protokoll, herding, autentisering, scope, verktøysemantikk, leverandørmatrise for alle fem, delt domenelag).

## Korreksjonsleveranse: SDK-sannhet, transportsemantikk, OAuth-invarianter og pakkesannhet

- [x] SDK-en er faktisk i kjørebanen: `JSONRPCRequestSchema`, `JSONRPCNotificationSchema`, `RequestIdSchema`, `InitializeRequestSchema`, `PingRequestSchema`, `ListToolsRequestSchema`, `CallToolRequestSchema` og `SUPPORTED_PROTOCOL_VERSIONS` validerer hver forespørsel. SDK-ens `Server`/transport brukes ikke, og det er dokumentert eksakt hvorfor.
- [x] Accept krever BÅDE `application/json` og `text/event-stream` med `q > 0`. Robust medietype-/q-parser med tester for manglende type, `q=0`, store/små bokstaver, wildcards og gyldig kombinasjon.
- [x] Origin: manglende tillates, `null` og fremmede avvises med 403 — også på OPTIONS. Kjent origin gir 204 med snevre CORS-headere; manglende origin gir 204 uten CORS.
- [x] `id: null` avvises som `-32600`; fravær av `id` er fortsatt notifikasjon (202).
- [x] Ytre fail-closed feilgrense: generisk `-32603` uten stack, token, body, argumenter eller DB-tekst.
- [x] `karrierenmin_status` sitt `outputSchema` krever `capabilities_verified` og `last_verified_at`. Faktisk statusresultat valideres mot skjemaet med SDK-ens AJV-validator i test.
- [x] Adgang kun ved `active`: `draft`/`connecting`/`degraded`/`disconnected` avvises. Regresjonstester for alle statusene.
- [x] Scope kryssjekkes mot grantets nåværende scopes ved hvert kall; effektive scopes er skjæringsmengden, og et tilbaketrukket scope avviser tokenet.
- [x] Leverandørpakkene er ikke lenger fem identiske `mcp.config.json`. Dokumentasjonsmanifest `common/connection.json` (ikke importerbart), dokumenterte filformater kun for Claude Code (`claude/mcp.json` → `.mcp.json`) og Gemini CLI (`settings.example.json` med `httpUrl`), og UI-/veiviserveiledning for ChatGPT/Codex, Copilot Studio og Grok. Pakketestene validerer leverandørspesifikk sannhet.
- [x] Full suite (26 filer / 435 tester), typecheck, lint og build passerte. Ingen DB-migrasjon, ingen publisering.

## Åpne punkter (blokkert / ikke gjort)

- [ ] Performance Advisor som eget verktøy er ikke tilgjengelig i dette miljøet. Erstattet med manuell indekskontroll: manglende indekser på fremmednøkler i OAuth-tabellene ble lagt til i migrasjon `20260909143412_...`.
- [ ] `PUBLIC_APP_ORIGIN` mangler i preview-miljøet. Transporten er fail-closed og svarer 500 uten den; dette er IKKE omgått. Blokkerer lokal/live røyktest.
- [ ] MCP Inspector mot en publisert origin er ikke kjørt: transporten krever `PUBLIC_APP_ORIGIN` og en offentlig HTTPS-adresse, og publisering er ikke tillatt i denne leveransen.
- [ ] Live E2E mot ChatGPT/Claude/Copilot/Grok/Gemini: IKKE KJØRT. Krever ekte konto og installasjon hos leverandør. Gjelder også etter at MCP-transporten er bygget.
- [ ] Migrasjonskravet «én ny migrasjon» ble i praksis fire filer: hovedherding (`20260909141023_...`), retting av tvetydig `family_id` (`20260909142117_...`) og indeksering (`20260909143412_...`), i tillegg til fase 3-basen. Alle er additive.
