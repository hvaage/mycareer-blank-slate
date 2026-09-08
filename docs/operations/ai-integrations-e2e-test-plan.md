# AI-integrasjoner — testplan

Skiller det som faktisk er verifisert automatisk fra det som krever ekte konto
hos hver leverandør. Ingenting her påstår at live-testene er kjørt.

## 1. Automatiserte tester (kjørt i dette repoet)

| Område | Fil | Dekker |
| --- | --- | --- |
| Kode og claim | `src/lib/__tests__/ai-integrations-claim.test.ts` | normalisering (bindestrek/små bokstaver), formatvalidering før databasekontakt, hash av normalisert kode, utløp, capability-allowlist, server-side mode-utledning, status- og workflow-allowlist, generisk avvisning, ignorert `user_id`/`integration_id`, grunnrate |
| Token | `src/lib/__tests__/ai-integrations-token.test.ts` | signatur, unik `jti`, endret signatur/innhold, utløpt token, feil audience, ødelagt token, manglende/for kort hemmelighet, tjenestenøkkel aldri brukt, ingen hemmelighet i tokenet |
| Leverandørpakker | `src/lib/__tests__/ai-integrations-packages.test.ts` | samme claim/status-testvektor for alle fire pakkene, felles kontraktfiler, offentlig HTTPS-placeholder (ingen `localhost`), forbud mot token i URL/logg, faktiske capabilities, ingen oppdiktet marketplace-ID, ingen hemmeligheter i repoet |
| Kontrakt og lagring | `ai-integrations-contract.test.ts`, `ai-integrations-put-regression.test.ts`, `ai-integrations-setup-code.test.ts` | onboarding, «Jeg vil velge senere», preferanselagring uten leverandør, bevart status/capabilities, `partial_failure`, kodeformat og utløp |

Kjøres med `bunx vitest run`.

### Dobbeltbruk og atomisitet

Claim bruker én betinget oppdatering:
`UPDATE ... WHERE setup_code_hash = ... AND provider = ... AND consumed_at IS NULL AND expires_at > now()`.
Postgres serialiserer raden, så av to samtidige kall får nøyaktig ett rad tilbake
og det andre får null. Ingen ny databasefunksjon eller migrasjon var nødvendig.
Enhetstestene dekker kontrakten; selve raddisiplinen er en databasegaranti og
kan bekreftes i live-test L1 under.

## 2. Live ende-til-ende-tester (ikke kjørt — krever ekte konto)

Hver test krever installert pakke hos leverandøren og en ekte testbruker.

| ID | Test | Bestått når | Ikke bestått når |
| --- | --- | --- | --- |
| L1 | Claim én gang per leverandør (fire kjøringer) | integrasjonen blir `active`, token utstedt, `karrierenmin_status` svarer | claim feiler, eller samme kode virker to ganger |
| L2 | Gjenbruk av samme kode | andre forsøk avvises med generisk `invalid_claim` | koden virker igjen |
| L3 | Utløpt kode (vent > 15 min) | generisk avvisning | koden godtas |
| L4 | Feil leverandør på gyldig kode | generisk avvisning uten hint | svaret røper årsaken |
| L5 | Frakobling i Karrierenmin | neste statuskall avvises umiddelbart | agenten har fortsatt tilgang |
| L6 | `run` med tillatt workflow | HTTP 501 `not_available`, ingen jobb opprettet | falsk suksess |
| L7 | `run` med workflow slått av i preferansene | avvist | kjøres likevel |
| L8 | Capabilities-rapportering | rapportert verdi = faktisk evne | verdi utledet av abonnement |
| L9 | Lekkasjekontroll | verken kode eller token finnes i agentens logg, svar eller URL | funnet noe sted |

## 3. Blokkeringer

- **Live E2E:** krever konto og installasjon hos alle fire leverandørene. Ikke gjort.
- **Marketplace:** ingen av pakkene er innsendt til noen offisiell katalog.
- **Innkommende e-post:** DNS og `INBOUND_EMAIL_DOMAIN` er ikke satt.
  Se `inbound-email-domain-setup.md`. Grensesnittet viser nøytral ventestatus.
- **Rate limiting:** per serverinstans, i minnet. Ikke distribuert. Robust
  variant krever egen tabell, altså skjemaendring, som ikke er autorisert.
- **Ikke-kjørt migrasjon:** ingen. Ingen ny migrasjonsfil var nødvendig.
- **Publisering:** ikke gjort.

## 4. Opprydding etter test

1. Koble fra testintegrasjonene i Karrierenmin (setter `disconnected` og
   forbruker ubrukte koder).
2. Slett lagret `integration_token` i hver assistents secret-lager.
3. Slett testradene for testbrukerne i `ai_integrations`,
   `ai_integration_setup_sessions` og `automation_runs`.
4. Bekreft at ingen produksjonsbrukerdata er berørt.
