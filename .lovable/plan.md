# Oppgave A — fjern stille degradering i edge-funksjoner

Kun feilhåndtering. Ingen endring i hva funksjonene gjør når alt virker. Ingen bytte av AI-leverandør (spor B). Ingen deploy før rapporten er gjennomgått.

## Prinsipper som implementeres

1. Preflight: alle nødvendige miljøvariabler valideres før arbeid starter → `503` med navn på manglende variabel.
2. Delvis feil telles: `attempted / succeeded / failed` returneres og logges.
3. Ingen tom `catch`: alle fangede feil logges med kontekst (funksjon, run_id, rad-id/orgnr, hvilket kall).
4. Status har tre tilstander: `ok` / `partial` / `failed`.
5. Tomt resultat skilles fra feilet resultat i logg og respons.

## Funn og planlagte endringer

### sync-nav-opportunities/index.ts
- **L27 / L538 `callAi` — `if (!LOVABLE_API_KEY) return null`.** Stille: kjøringen fortsetter uten scoring, svarer 200, `error_summary = null`. Nytt: `LOVABLE_API_KEY` inn i preflight sammen med `SUPABASE_URL`, `SERVICE_ROLE_KEY`, `NAV_SOURCE_*`, `SYNC_NAV_SECRET` → 503 før noe hentes.
- **L552 `if (!res.ok) return null` og L562 `catch { return null }`.** Stille: HTTP-feil og parsefeil fra AI-gateway ser identiske ut som "ingen score". Nytt: `callAi` returnerer `{ ok, value } | { ok:false, reason, status, bodyExcerpt }`; kaller logger og teller.
- **L654 `if (LOVABLE_API_KEY) { ... }`.** Stille: hele scoringsblokken hoppes over uten spor. Nytt: blokken kjører alltid (nøkkel er garantert av preflight); `runMatching` returnerer `ai_attempted / ai_succeeded / ai_failed`, som skrives til `nav_sync_runs.meta` og responsen.
- **L83 / L88 lease heartbeat/release `catch { /* noop */ }`.** Nytt: `console.warn` med `run_id` og lease-navn. Feilen skal fortsatt ikke velte kjøringen (heartbeat-tap håndteres av TTL) — men den skal være synlig.
- **Statusfelt.** `ok: errorSummary == null` erstattes av `status: "ok" | "partial" | "failed"`: `partial` når `ai_failed > 0`, `systemErrors.length > 0` eller `res.failed > 0`. `ok` beholdes for bakoverkompatibilitet = `status !== "failed"`.
- **Tomt vs. feilet:** `fetched = 0` logges eksplisitt som `empty_upstream` når RPC lyktes, atskilt fra `system_error: nav rpc failed`.

### fetch-careerjet-listings/index.ts
- **L744 og L839 — `Deno.env.get("LOVABLE_API_KEY")` lest lokalt, blokken hoppes over hvis tom.** Nytt: nøkkelen (samt `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CAREERJET_AFFID`) valideres i preflight øverst i handleren → 503. De to `if (lovableKey)`-vaktene fjernes.
- **L1011-1012 og L1122-1123 — AI-gateway ikke-2xx → `return 0`.** Stille: null scoret ser ut som ingenting å score. Nytt: returnerer `{ attempted, scored, failed, lastError }`; teller rulles opp i responsen.
- **L1019-1021 og L1128-1130 — ikke-JSON-svar → `return 0`.** Nytt: samme tellerstruktur; feilen logges allerede, men skal nå også telles og rapporteres.
- **L736, L759, L768, L856, L860 — `catch` som kun logger og fortsetter.** Beholdes som "fortsett", men bidrar nå til `partial`-status og en `errors[]`-liste i responsen med fase-navn.
- **L505-506 — henting per keyword/lokasjon feiler.** Nytt: teller `pages_failed` per keyword; kjøring med `pages_failed > 0` blir `partial`.
- **Respons:** legger til `status`, `ai: { attempted, scored, failed }`, `errors[]`.

### score-pending-opportunities/index.ts
- **L22 `LOVABLE_API_KEY ?? ""` + L652 `throw new Error("ai_key_missing")` midt i arbeidet.** Kastet skjer først etter kandidatvalg og evidenshenting. Nytt: preflight i handleren → 503 `{ missing: ["LOVABLE_API_KEY"] }` før kandidatvalg.
- **L823 `catch { body = {} }`** — beholdes (ugyldig/ tom body er lovlig og gir `400 invalid_input` senere), men logges på debug-nivå.
- **L973 skrivefeil per kandidat** — allerede talt i `failures`. Nytt: `status: "partial"` når `failed > 0`, i dag returneres 200 uten skille.
- **Tomt vs. feilet:** `selected = 0` merkes `reason: "no_candidates"`.

### sync-careerjet-opportunities/index.ts
- **L244, L286 lease-heartbeat `catch { /* swallow */ }`** → `console.warn` med run_id og fencing_token.
- **L583 lease-release `catch { /* swallow */ }`** → `console.error` med run_id; release-feil er en reell risiko for at neste kjøring blokkeres.
- **L156 `catch { /* ignore */ }` på `req.json()`** — beholdes (tom body er gyldig), men logges på debug-nivå.
- Preflight for `SUPABASE_URL`, `SERVICE_ROLE_KEY`, `SYNC_CAREERJET_SECRET`, `CAREERJET_AFFID`.

### extract-job-ad/index.ts
- **L104-105** — kaster allerede ved manglende nøkkel, men først etter URL-henting. Flyttes til preflight; svar endres fra 500 til 503 med variabelnavn.

### regnskap-sync
- **index.ts L114** — allerede eksplisitt preflight på `SUPABASE_DB_URL`. Status endres fra 500 til 503 for konsistens; ingen annen endring.
- **db.ts L38/L67/L409, warmup.ts L86, index.ts L166 (`closePool`, `ROLLBACK`)** — **lot stå.** Dette er opprydding i `finally`-blokker der originalfeilen allerede propagerer; logging her ville skjule den. Legger til én `console.warn` i `closePool` slik at pool-lekkasje er sporbar.

## Steder som bevisst lates i fred

| Sted | Begrunnelse |
|---|---|
| `sync-nav-opportunities` L128-154, `navDisplayUrl`/parsere `return null` | Valgfritt felt mangler i upstream-payload — legitimt fravær, ikke feil. Dekkes allerede av `dataIssues`. |
| `generate-cover-letter` L190-215 `return null` | Parsing av valgfrie seksjoner i AI-svar; manglende seksjon er gyldig utfall. |
| `generate-cover-letter` L314-318 `?? ""` | Defaults for valgfrie tekstblokker. |
| `analyze-company` L384 `catch` på URL-parsing | URL-er er allerede validert oppstrøms; kommentaren dokumenterer det. |
| `analyze-company` L315, L565 `catch { /* ignore */ }` | Verifiseres i gjennomgangen; hvis de dekker skriving av jobbstatus blir de logget, ellers står de. |
| `linkedin-*`, `commit-cv-import`, `delete-account`, `parse-uploaded-cv` | Bruker `!`-assert på env og feiler høylytt ved manglende variabel. Får preflight kun hvis gjennomgangen viser at en manglende variabel gir 200. |
| `analyze-company` AI-kall mot Anthropic | Utenfor scope per avgrensning (spor B). |

## Teknisk gjennomføring

- Ny delt modul `supabase/functions/_shared/preflight.ts`:
  - `requireEnv(names: string[]): { ok: true; env: Record<string,string> } | { ok: false; missing: string[] }`
  - `missingEnvResponse(missing, corsHeaders)` → `503 { error: "missing_configuration", missing: [...] }`
  - `RunTally`-hjelper med `attempted/succeeded/failed`, `addFailure(context, error)` og `status()` → `ok|partial|failed`.
- Deno-tester i `_shared/preflight_test.ts` samt oppdaterte tester for tellerlogikken i `score-pending-opportunities`.
- Ingen migrasjoner. `nav_sync_runs.meta` er `jsonb`, så nye tellere krever ikke skjemaendring.
- Verifisering før deploy: `supabase--test_edge_functions` for de berørte funksjonene + `tsgo --noEmit`.

## Leveranse

Rapport per funn med fil, linjenummer, tidligere stille oppførsel, ny oppførsel, og begrunnede unntak. Deploy skjer først etter din gjennomgang.
