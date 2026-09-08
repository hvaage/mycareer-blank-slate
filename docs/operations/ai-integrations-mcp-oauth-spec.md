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

## Sikkerhetsegenskaper som er testet

- Discovery annonserer bare implementerte funksjoner; ingen OIDC, `openid`,
  `email`, `userinfo` eller CIMD. `iss` returneres i alle authorization
  responses, derfor er `authorization_response_iss_parameter_supported: true`.
- Eksakt redirect-URI. Ingen prefiks, wildcard, ekstra spørring eller fragment.
  Feil som oppstår før redirect-URI er bekreftet kan aldri videresendes.
- PKCE S256 er obligatorisk; verifier valideres på lengde (43–128) og alfabet.
- Authorization code lever i 60 sekunder, lagres kun som SHA-256-hash og
  konsumeres atomisk med advisory lock. Gjenbruk trekker grantet.
- Refresh token roteres atomisk; gjenbruk trekker hele familien og grantet.
- Access token har 60 minutters levetid og egen `typ`, `aud`/`resource`, `jti`
  og `grant_id`. Et gammelt agenttoken kan aldri passere som OAuth-token.
- Alle tokensvar er `no-store` / `no-cache`.
- Frakobling av assistenten trekker alle grants og fornyelsesnøkler.
- Ingen kode, verifier eller token skrives til logg eller URL.

## Testprosedyre

```bash
bunx vitest run src/lib/__tests__/ai-integrations-oauth-flow.test.ts   # 60 tester
bunx vitest run                                                        # hele suiten
bunx tsgo --noEmit -p tsconfig.json
bun run build
```

Ende-til-ende mot ChatGPT/Codex, Claude, Grok eller Gemini er **IKKE KJØRT** og
er blokkert inntil en faktisk klient er forhåndsregistrert og appen er
publisert på den kanoniske originen.
