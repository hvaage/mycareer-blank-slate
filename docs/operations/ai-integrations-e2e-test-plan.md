# AI-integrasjoner — testplan

Skiller det som faktisk er verifisert automatisk fra det som krever ekte konto
hos hver leverandør. Ingenting her påstår at live-testene er kjørt.

## 1. Automatiserte tester (kjørt i dette repoet)

| Område | Fil | Dekker |
| --- | --- | --- |
| Kode og claim | `src/lib/__tests__/ai-integrations-claim.test.ts` | normalisering (bindestrek/små bokstaver), formatvalidering før databasekontakt, hash av normalisert kode, utløp, capability-allowlist, server-side mode-utledning, status- og workflow-allowlist, generisk avvisning, ignorert `user_id`/`integration_id`, grunnrate |
| Token | `src/lib/__tests__/ai-integrations-token.test.ts` | signatur, unik `jti`, endret signatur/innhold, utløpt token, feil audience, ødelagt token, manglende/for kort hemmelighet, tjenestenøkkel aldri brukt, ingen hemmelighet i tokenet |
| Leverandørpakker | `src/lib/__tests__/ai-integrations-packages.test.ts` | samme claim/status-testvektor for alle fire pakkene, felles kontraktfiler, offentlig HTTPS-placeholder (ingen `localhost`), forbud mot token i URL/logg, eksplisitt ikke-installerbar status, ingen påstand om fungerende MCP-server, ingen påstand om automatisk tokenlagring, ingen oppdiktet marketplace-ID, ingen hemmeligheter i repoet |
| Capabilities og robusthet | `src/lib/__tests__/ai-integrations-robustness.test.ts` | klientpåstand gir alltid tomme capabilities, ruten leser ikke capabilities, oppbrukt kode krever ny kode, koden logges aldri, kilde-IP-utledning og dokumentert `x-forwarded-for`-forutsetning |
| Kontrakt og lagring | `ai-integrations-contract.test.ts`, `ai-integrations-put-regression.test.ts`, `ai-integrations-setup-code.test.ts` | onboarding, «Jeg vil velge senere», preferanselagring uten leverandør, bevart status/capabilities, `partial_failure`, kodeformat og utløp |

Kjøres med `bunx vitest run`.

### Dobbeltbruk og atomisitet

Claim bruker én betinget oppdatering:
`UPDATE ... WHERE setup_code_hash = ... AND provider = ... AND consumed_at IS NULL AND expires_at > now()`.
Postgres serialiserer raden, så av to samtidige kall får nøyaktig ett rad tilbake
og det andre får null. Ingen ny databasefunksjon eller migrasjon var nødvendig.
Enhetstestene dekker kontrakten; selve raddisiplinen er en databasegaranti og
kan bekreftes i live-test L1 under.

## 2. Live ende-til-ende-tester (SPERRET — kan ikke kjøres eller markeres bestått ennå)

**Sperre:** ingen av de fire pakkene er installerbare. Dagens endepunkter er
vanlige REST-ruter uten MCP-transport, og det finnes ingen plugin. Live-testene
under **kan ikke markeres bestått** før ekte MCP-/plugin-transport med
autentisering er implementert etter
`docs/operations/ai-integrations-mcp-oauth-spec.md`, og pakken faktisk er
installert hos leverandøren av en ekte testbruker.

Et manuelt `curl`-kall mot REST-rutene teller ikke som bestått live-test. Det
tester backendkontrakten, ikke integrasjonen.

Forutsetninger som alle må være oppfylt før tabellen tas i bruk:

1. MCP-endepunkt svarer korrekt på `initialize`, `tools/list` og `tools/call`.
2. OAuth-discovery og autorisasjonsflyt virker for den aktuelle overflaten.
3. Pakken er installert i klienten og autentisert gjennom den flyten.
4. En ekte testbruker med egen Karrierenmin-konto utfører stegene.

| ID | Test | Bestått når | Ikke bestått når |
| --- | --- | --- | --- |
| L1 | Claim én gang per leverandør (fire kjøringer) | integrasjonen blir `active`, token utstedt, `karrierenmin_status` svarer | claim feiler, eller samme kode virker to ganger |
| L2 | Gjenbruk av samme kode | andre forsøk avvises med generisk `invalid_claim` | koden virker igjen |
| L3 | Utløpt kode (vent > 15 min) | generisk avvisning | koden godtas |
| L4 | Feil leverandør på gyldig kode | generisk avvisning uten hint | svaret røper årsaken |
| L5 | Frakobling i Karrierenmin | neste statuskall avvises umiddelbart | agenten har fortsatt tilgang |
| L6 | `run` med tillatt workflow | HTTP 501 `not_available`, ingen jobb opprettet | falsk suksess |
| L7 | `run` med workflow slått av i preferansene | avvist | kjøres likevel |
| L8 | Capabilities etter claim | alle egenskaper står som ubekreftet, uansett hva klienten påstår | en egenskap er `true` uten fullført serverkontrollert challenge |
| L10 | Capability-challenge (når implementert) | egenskap settes `true` først etter at serveren har observert den faktisk utført | verdi utledet av abonnement eller klientpåstand |
| M1 | MCP `initialize` + `tools/list` i klienten | begge verktøyene vises med riktige scopes og annotations | verktøy mangler eller har feil navn |
| M2 | OAuth-oppdagelse fra `401` | klienten finner autorisasjonsserveren via `WWW-Authenticate` og fullfører PKCE | klienten ber om en statisk nøkkel |
| M3 | `karrierenmin_status` over MCP | samme innhold som REST-statusen | avvik mellom lagene |
| M4 | `karrierenmin_run` over MCP | `not_enabled` eller `not_available`, ingen kjøring opprettet | falsk suksess |
| M5 | Tilgang uten `karriere.workflow.run` | HTTP 200 med verktøyfeil `insufficient_scope` | verktøyet kjører likevel |
| M6 | Frakobling midt i en økt | neste kall gir `401` | agenten har fortsatt tilgang |
| L9 | Lekkasjekontroll | verken kode eller token finnes i agentens logg, svar eller URL | funnet noe sted |

## 3. Blokkeringer

- **Live E2E:** IKKE KJØRT. MCP-transporten og OAuth finnes nå, men en live
  test krever installasjon og ekte konto hos ChatGPT/Codex, Claude, Gemini, Grok
  eller Microsoft Copilot, samt en publisert kanonisk origin. Ingen av delene er
  gjort i denne leveransen.
- **MCP:** implementert. Sesjonsløs Streamable HTTP på `POST /api/public/mcp`,
  verktøyene `karrierenmin_status` og `karrierenmin_run`, scope per verktøy.
  Dekket av handler-, protokoll-, sikkerhets- og leverandørmatrise-tester.
- **Capability-verifisering:** ikke implementert. Claim lagrer alltid tomme,
  ubekreftede egenskaper.
- **Marketplace:** ingen av pakkene er innsendt til noen offisiell katalog.
- **Innkommende e-post:** DNS og `INBOUND_EMAIL_DOMAIN` er ikke satt.
  Se `inbound-email-domain-setup.md`. Grensesnittet viser nøytral ventestatus.
- **Rate limiting:** claim bruker distribuert `claim_rate_events`. MCP-laget har
  ingen egen ratebegrensning utover OAuth-tokenets levetid og revokering.
- **Ikke-kjørt migrasjon:** ingen. Ingen ny migrasjonsfil var nødvendig.
- **Publisering:** ikke gjort.

## 4. Opprydding etter test

1. Koble fra testintegrasjonene i Karrierenmin (setter `disconnected` og
   forbruker ubrukte koder).
2. Slett lagret `integration_token` i hver assistents secret-lager.
3. Slett testradene for testbrukerne i `ai_integrations`,
   `ai_integration_setup_sessions` og `automation_runs`.
4. Bekreft at ingen produksjonsbrukerdata er berørt.
