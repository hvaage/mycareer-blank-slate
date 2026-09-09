# Spesifikasjon: ekte MCP-transport og OAuth 2.1 for Karrierenmin

Status: **OAuth 2.1/PKCE (fase 3) er implementert. MCP-transporten er fortsatt ikke bygget. Se statusoppdateringen nederst i dokumentet.**

Dagens `/api/public/ai-integrations/*` er vanlige REST-ruter. De implementerer
ikke MCP. Denne filen beskriver hva som må bygges før noen pakke kan kalles
installerbar.

## 1. MCP-transport

- Ett endepunkt: `POST /api/public/mcp`, Streamable HTTP med JSON-RPC 2.0.
- Requesten må sende `Content-Type: application/json` og
  `Accept: application/json, text/event-stream`. Uten `Accept` svarer
  MCP-klienter/servere 406.
- Svar enten `application/json` eller `text/event-stream` avhengig av om
  metoden strømmer.
- Obligatoriske metoder: `initialize`, `tools/list`, `tools/call`.
  `initialize` returnerer `protocolVersion`, `serverInfo` og `capabilities.tools`.
- `notifications/initialized` godtas og besvares ikke.
- Ukjent metode → JSON-RPC-feil `-32601`. Ugyldige argumenter → `-32602`.
  Domenefeil returneres som `isError: true` i `tools/call`-resultatet, ikke som
  transportfeil.

### Verktøy som eksponeres

| Verktøy | Beskrivelse | Input |
| --- | --- | --- |
| `karrierenmin_status` | status, bekreftede capabilities, `effective_mode`, tilgjengelige arbeidsflyter | `{}` |
| `karrierenmin_run` | be om en tillatt arbeidsflyt | `{ workflow_kind }` |

`karrierenmin_claim` eksisterer **ikke** som MCP-verktøy. Aktivering skjer i
autorisasjonsflyten (punkt 3), ikke som et verktøykall som returnerer en
hemmelighet.

Hvert verktøy har `inputSchema` som JSON Schema. `tools/list` er identisk for
alle fire overflater; det er samme server.

## 2. OAuth 2.1 discovery

- `GET /.well-known/oauth-protected-resource` → `resource`,
  `authorization_servers`, `scopes_supported`, `bearer_methods_supported: ["header"]`.
- `GET /.well-known/oauth-authorization-server` → `issuer`,
  `authorization_endpoint`, `token_endpoint`, `revocation_endpoint`,
  `registration_endpoint`, `code_challenge_methods_supported: ["S256"]`,
  `grant_types_supported: ["authorization_code", "refresh_token"]`,
  `response_types_supported: ["code"]`,
  `token_endpoint_auth_methods_supported: ["none", "client_secret_basic"]`.
- Uautentisert `POST /api/public/mcp` svarer `401` med
  `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`,
  slik at klienten finner autorisasjonsserveren selv.

## 3. Authorization endpoint og account linking

`GET /oauth/authorize` med `response_type=code`, `client_id`, `redirect_uri`,
`scope`, `state`, `code_challenge`, `code_challenge_method=S256`.

1. Er brukeren ikke innlogget i Karrierenmin, sendes hen til `/auth` med
   returadresse.
2. Samtykkeside viser hvilken klient som ber om tilgang og hvilke scopes.
3. **Account linking med engangskode:** samtykkesiden kan enten (a) knytte den
   innloggede brukeren direkte, eller (b) be om engangskoden fra Karrierenmin
   når klienten kjører i en annen kontekst enn brukerens nettleser. Koden
   normaliseres, hashes med SHA-256 og forbrukes med samme atomiske betingede
   oppdatering som i dag. Koden forlater aldri serveren og logges aldri.
4. `redirect_uri` må være eksakt registrert. Ingen wildcard, ingen delvis match.
5. Autorisasjonskoden er engangs, lever i 60 sekunder og er bundet til
   `client_id`, `redirect_uri` og `code_challenge`.
6. `state` returneres uendret og valideres av klienten.

## 4. Token endpoint

`POST /oauth/token`, `application/x-www-form-urlencoded`.

- `grant_type=authorization_code` med `code`, `redirect_uri`, `client_id` og
  `code_verifier`. Serveren verifiserer S256 mot lagret `code_challenge`.
- `grant_type=refresh_token` med rotasjon: brukt refresh-token invalideres, nytt
  utstedes. Gjenbruk av et rotert refresh-token tilbakekaller hele grantet.
- Svar: `access_token` (kort levetid, foreslått 60 minutter), `token_type`,
  `expires_in`, `refresh_token`, `scope`.
- Access-tokenet beholder dagens HMAC-format og felter (`iid`, `sub`,
  `provider`, `aud`, `iat`, `exp`, `jti`) med `AI_INTEGRATION_TOKEN_SECRET`.
  Aldri `SUPABASE_SERVICE_ROLE_KEY`.
- Feil bruker OAuth-feilkoder (`invalid_grant`, `invalid_client`,
  `invalid_request`) uten å røpe hvilken del som feilet mer enn nødvendig.

## 5. Scopes

| Scope | Gir |
| --- | --- |
| `karriere.status.read` | `karrierenmin_status` |
| `karriere.workflow.run` | `karrierenmin_run` for arbeidsflyter brukeren har slått på |

Ingen scope gir rå e-post, LinkedIn-data, CV-innhold eller nøkler. Scope
kontrolleres i tillegg til `automation_preferences`; det strengeste vinner.

## 6. Revocation og frakobling

- `POST /oauth/revoke` etter RFC 7009.
- Frakobling i Karrierenmin setter integrasjonen `disconnected` og tilbakekaller
  alle access- og refresh-tokens for den integrasjonen umiddelbart. Neste
  MCP-kall svarer `401`.

## 7. Klientregistrering

- Dynamisk registrering (RFC 7591) på `POST /oauth/register` for klienter som
  krever det, med `token_endpoint_auth_method: "none"` for offentlige klienter
  og obligatorisk PKCE.
- Registrering kan slås av per miljø. Er den av, må `client_id` finnes i en
  eksplisitt allowlist.

## 8. Samme server, fire overflater

| Overflate | Bruk |
| --- | --- |
| ChatGPT / Codex-plugin | Full OAuth 2.1 + PKCE mot samme MCP-endepunkt. Ingen manuell token-kopiering. |
| Codex / Claude lokal MCP-klient | Samme endepunkt. Enten OAuth der klienten støtter det, ellers et access-token som brukeren eller et installasjonsprogram kopierer inn i klientens secret-/miljøoppsett. Ingen automatisk lagring. |
| Gemini | Samme endepunkt når en verifisert plattformmekanisme finnes. Til da: portabel designmal. |
| Grok | Samme. |

Serveren skiller ikke på leverandør i logikken. `provider` er kun metadata på
integrasjonen.

## 9. Capabilities-verifisering (henger sammen med claim)

Claim og account linking bekrefter **ingen** capabilities. En egenskap kan først
settes til `true` etter en serverkontrollert challenge, for eksempel:

- `scheduled_runs`: serveren ber klienten kalle et bestemt verktøy innenfor et
  gitt tidsvindu uten brukerinteraksjon, og observerer at det faktisk skjer.
- `background_execution`: tilsvarende, uten aktiv samtale.
- `email_forward_or_send`: bekreftes av at en videresendt e-post faktisk kommer
  inn på brukerens private importadresse.

Til da viser grensesnittet at forbindelsen er aktiv, men at ingen egenskaper er
bekreftet.

## 10. Akseptansekriterier for neste leveranse

1. `initialize`, `tools/list` og `tools/call` svarer korrekt JSON-RPC.
2. Uautentisert kall gir `401` med korrekt `WWW-Authenticate`.
3. Begge discovery-dokumentene validerer.
4. Autorisasjonskode uten gyldig `code_verifier` avvises.
5. Rotert refresh-token kan ikke gjenbrukes.
6. Frakobling tilbakekaller tilgang umiddelbart.
7. Engangskode brukt i account linking kan ikke brukes to ganger.
8. Ingen capability settes `true` uten fullført challenge.

---

# Statusoppdatering: fase 3 er implementert (OAuth 2.1/PKCE)

Denne delen erstatter statuslinjen øverst for alt som gjelder OAuth. **MCP-
transporten (punkt 1) er fortsatt ikke bygget.** OAuth-laget under er
implementert, testet og migrasjonen er anvendt. Ingen publisering er gjort, og
det finnes ingen verifisert ende-til-ende-test mot en faktisk leverandør.

## Implementert

| Del | Rute/fil | Status |
| --- | --- | --- |
| Protected-resource metadata | `src/routes/[.]well-known/oauth-protected-resource.ts` | ferdig |
| Authorization-server metadata | `src/routes/[.]well-known/oauth-authorization-server.ts` | ferdig |
| Validering av authorization request | `src/routes/api/public/oauth/prepare.ts` | ferdig |
| Samtykkeside (norsk) | `src/routes/oauth.authorize.tsx` | ferdig |
| Godkjenning/avvisning (POST + CSRF) | `src/routes/api/oauth/consent.ts` | ferdig |
| Token endpoint | `src/routes/api/public/oauth/token.ts` | ferdig |
| Revocation (RFC 7009) | `src/routes/api/public/oauth/revoke.ts` | ferdig |
| Dynamisk klientregistrering | `src/routes/api/public/oauth/register.ts` | av som standard |
| Retur etter innlogging | `src/routes/api/public/oauth/return.ts` | ferdig |
| Tokenverifisering mot database | `src/lib/ai-integrations/oauth-auth.server.ts` | ferdig |
| Revokering ved frakobling | `src/routes/api/ai-integrations/index.ts` (DELETE) | ferdig |
| MCP Streamable HTTP | — | **ikke bygget** |

## Miljøvariabler

| Variabel | Påkrevd | Betydning |
| --- | --- | --- |
| `PUBLIC_APP_ORIGIN` | ja | Kanonisk HTTPS-origin. Issuer og resource utledes kun herfra, aldri fra `Host` eller `x-forwarded-host`. Mangler den, svarer OAuth-rutene 500. |
| `AI_INTEGRATION_OAUTH_SECRET` | ja | Minst 32 tegn. Signerer access tokens og alle kortlivede tilstander. Bevisst en annen nøkkel enn `AI_INTEGRATION_TOKEN_SECRET`. |
| `AI_INTEGRATION_TOKEN_SECRET` | ja (eldre flyt) | Det gamle 30-dagers agenttokenet. Beholdes som separat kompatibilitetsflyt. |
| `OAUTH_DYNAMIC_REGISTRATION` | nei | Sett til `enabled` for å åpne `POST /api/public/oauth/register`. Uten den er ruten av og `registration_endpoint` annonseres ikke. |
| `OAUTH_ALLOW_LOOPBACK_REDIRECTS` | nei | Kun utviklingsmiljø. Sett aldri i produksjon. |

Hemmelighetene legges inn under Prosjektinnstillinger → Secrets. De skal aldri
ligge i repoet.

## Forhåndsregistrering av klient

Åpen registrering er av. En klient legges inn direkte i `oauth_clients`, som
bare serverrollen har tilgang til:

```sql
insert into public.oauth_clients
  (client_id, client_name, client_type, redirect_uris, allowed_scopes, is_active)
values
  ('chatgpt-karrierenmin', 'ChatGPT', 'public',
   array['https://chatgpt.com/connector_platform_oauth_redirect'],
   array['karriere.status.read', 'karriere.workflow.run'], true);
```

Regler: kun `public` clients (ingen client secret i repoet), eksakt
redirect-URI uten wildcard eller fragment, og bare scopes klienten faktisk
trenger. En klient deaktiveres med `update ... set is_active = false`, som
stanser nye autorisasjoner umiddelbart; eksisterende tilganger trekkes med
`select public.oauth_revoke_grants(...)`.

## Nøkkelrotasjon

1. Sett ny `AI_INTEGRATION_OAUTH_SECRET`.
2. Alle utstedte access tokens slutter å verifisere umiddelbart (levetid er
   uansett 60 minutter), og alle åpne samtykkesider må startes på nytt.
3. Refresh tokens lagres kun som hash i databasen og påvirkes ikke av
   rotasjonen; klienten får nytt access token ved neste fornyelse.
4. Ved mistanke om kompromittering: rotér nøkkelen **og** kjør
   `oauth_revoke_grants` for berørte brukere eller integrasjoner.

## Klientregistrering: CIMD først, DCR som fallback

### 1. CIMD (Client ID Metadata Document) — foretrukket

`client_id` er selve https-adressen til klientens metadatadokument. Ingen
forhåndsregistrering trengs. Discovery annonserer
`client_id_metadata_document_supported: true` og
`token_endpoint_auth_methods_supported: ["none"]`.

Tillatte adresser (ingen andre hentes):

| Klient | Adresse |
| --- | --- |
| ChatGPT | `https://chatgpt.com/oauth/client.json` |
| ChatGPT (callback-modus) | `https://chatgpt.com/oauth/{callback_id}/client.json` |
| Claude Code | `https://claude.ai/oauth/claude-code-client-metadata` |

Hentingen er rammet inn: `redirect: "error"` (ingen omdirigering følges),
3 sekunders timeout, maks 32 kB, `application/json` kreves, dokumentet må
normalisere til nøyaktig samme adresse, og ingen userinfo, spørring, fragment
eller port godtas. Metadataen kan aldri utvide serverens tillatelser:
`client_id` (hvis satt) må være adressen selv, `token_endpoint_auth_method`
må være `none`, grant types begrenses til `authorization_code` og
`refresh_token`, response type til `code`, og scopes til serverens to.
Redirect-URI-er må ligge på klientens egen vert.

Resultatet lagres som en klientrad med `registration_method = 'cimd'`,
`metadata_url`, `metadata_validated_at` og `metadata_expires_at` (6 timer).
Utløpt eller ugyldig metadata revalideres før bruk, og en utløpt CIMD-klient
avvises i innløsingen. En forhåndsregistrert (`manual`) klient overstyres
aldri av et hentet dokument.

**Claude Code-loopback** (`http://localhost:<port>/callback` og
`http://127.0.0.1:<port>/callback`) godtas KUN når metadataen kom fra den
verifiserte Claude-adressen, med eksakt vert og bane og port over 1023.
Samtykkesiden viser da en tydelig advarsel om at tilgangen sendes til et
program på brukerens egen maskin. Generisk loopback er ikke åpnet for noen
annen klient og ikke for DCR.

### 2. DCR (RFC 7591) — kompatibilitetsfallback

Fortsatt av som standard (`OAUTH_DYNAMIC_REGISTRATION=enabled`). Kun public
clients; det utstedes aldri en `client_secret`. Redirect-URI-er må treffe en
eksakt allowliste:

| Klient | Callback |
| --- | --- |
| ChatGPT (hosted) | `https://chatgpt.com/connector_platform_oauth_redirect` |
| ChatGPT (callback-modus) | `https://chatgpt.com/connector/oauth/{callback_id}` |
| Claude (hosted) | `https://claude.ai/api/mcp/auth_callback` |

Microsoft Copilot og Grok har **ingen** innebygde adresser. Vi dikter ikke opp
et Microsoft- eller xAI-domene. Drift må legge den faktiske adressen inn i
`OAUTH_EXTRA_REDIRECT_URIS` (mellomrom- eller kommaseparerte eksakte
https-adresser) før registrering kan brukes.

Øvrige grenser: maks 8 kB body, maks 20 metadatafelt, maks 3 redirect-URI-er,
klientnavn maks 120 tegn, scopes kun fra serverens allowliste, distribuert
ratebegrensning i databasen (`claim_rate_check`), `registration_method='dcr'`
og `expires_at` 30 dager. `oauth_cleanup_expired_clients()` deaktiverer
utløpte klienter og sletter dem 30 dager senere når de ikke har aktive grants.
Autorisasjon og token avviser inaktive og utløpte klienter.

## Statusflyt og atomisitet

- Bare integrasjoner i `connecting` eller `active` kan autorisere og få
  tokener. `disconnected` og `error` blokkeres.
- Første vellykkede `authorization_code`-utveksling setter `connecting ->
  active` i SAMME transaksjon som koden konsumeres
  (`oauth_redeem_authorization_code_v2`). `active` forblir `active`.
- `capabilities` og `effective_mode` røres aldri av OAuth. Tokensvaret sier
  ingenting om egenskaper. `last_verified_at` betyr bekreftet forbindelse.
- **Preflight-invariant:** signeringshemmeligheten kontrolleres FØR koden
  eller refresh-tokenet konsumeres. Feiler konfigurasjonen, svarer vi 500 uten
  å ha endret databasen, og klienten beholder tokenet sitt.
- Gjenbruk av authorization code gir `invalid_grant` og en audit-hendelse i
  `oauth_security_events`, men trekker IKKE andre aktive grants.
- Refresh-rotasjon er atomisk med advisory lock. Ved replay trekkes kun
  tokenfamilien, med audit — grantet står.
- Access-tokenverifikasjon kontrollerer eksakt `iss`, `aud`/`resource`, `exp`
  og `iat` med **60 sekunders** dokumentert klokkeskeivhet, scope, aktiv
  klient, aktivt grant, aktiv integrasjon og at tokenets provider stemmer med
  databasen.
- `resource` følger fra authorize, lagres på autorisasjonskoden og
  sammenlignes eksakt ved innløsing før den blir `aud` i tokenet.
- Innloggingens callback logger aldri adresse, spørrestreng, kode, state eller
  token. Det er dekket av en regresjonstest.

## Microsoft Copilot

Copilot er den femte likestilte assistenten i kontrakter, validering,
onboarding, databasebegrensninger og kildepakker, uten forhåndsvalg. Pakken i
`integrations/karrierenmin-agents/copilot/` er en design-/kildemal — det finnes
ingen installerbar MCP-transport, og pakken påstår ikke noe annet. Verken
valg, claim eller OAuth bekrefter capabilities.

## Sikkerhetsegenskaper som er testet

- Discovery annonserer bare implementerte funksjoner; ingen OIDC, `openid`,
  `email` eller `userinfo`. CIMD annonseres nå eksplisitt. `iss` returneres i alle authorization
  responses, derfor er `authorization_response_iss_parameter_supported: true`.
- Eksakt redirect-URI. Ingen prefiks, wildcard, ekstra spørring eller fragment.
  Feil som oppstår før redirect-URI er bekreftet kan aldri videresendes.
- PKCE S256 er obligatorisk; verifier valideres på lengde (43–128) og alfabet.
- Authorization code lever i 60 sekunder, lagres kun som SHA-256-hash og
  konsumeres atomisk med advisory lock. Gjenbruk gir `invalid_grant` og audit,
  uten å trekke andre grants.
- Refresh token roteres atomisk; replay trekker kun tokenfamilien, med audit.
- Access token har 60 minutters levetid og egen `typ`, `aud`/`resource`, `jti`
  og `grant_id`. Et gammelt agenttoken kan aldri passere som OAuth-token.
- Alle tokensvar er `no-store` / `no-cache`.
- Frakobling av assistenten trekker alle grants og fornyelsesnøkler.
- Ingen kode, verifier eller token skrives til logg eller URL.

## Testprosedyre

```bash
bunx vitest run src/lib/__tests__/ai-integrations-oauth-flow.test.ts       # kontraktstester
bunx vitest run src/lib/__tests__/ai-integrations-oauth-hardening.test.ts  # CIMD, DCR, callback
bunx vitest run                                                        # hele suiten
bunx tsgo --noEmit -p tsconfig.json
bun run build
```

Databasetestene (statusovergang, capability-uforanderlighet, gjenbruk av kode,
refresh-replay, ressursbinding, frakoblet integrasjon, utløpt klient og
opprydding) kjøres som én transaksjon mot databasen som rulles tilbake, slik at
ingen testdata blir liggende igjen.

Ende-til-ende mot ChatGPT/Codex, Claude, Copilot, Grok eller Gemini er **IKKE KJØRT** og
er blokkert inntil en faktisk klient er forhåndsregistrert og appen er
publisert på den kanoniske originen.
