# Read-only diagnose: Supabase-target og regnskap-sync

Ingen kodeendringer, migrasjoner, deploys, cron-, secret- eller dataendringer er utført. Alt under er verifisert med read-only oppslag.

## 1. Supabase target-verifisering

| Felt | Verdi |
| --- | --- |
| Project ref | `miwzhbludgwvskmsfqnq` |
| URL | `https://miwzhbludgwvskmsfqnq.supabase.co` |
| Organization ID | `wpczgwxsriezaubncuom` |
| Managed by Lovable | Ja (Lovable Cloud-managed) |
| Instansstørrelse | Tiny |
| Pauset | Nei |
| Pooler | `aws-1-eu-north-1.pooler.supabase.com:6543` |

Om `wcaqfupjatnjwbgatzjv`: dette er **ikke** feil prosjekt og ingen ommigrering har skjedd. Det er et **separat, eksternt marked/ESCO-prosjekt** som appen leser fra i tillegg, hardkodet som fallback i `src/integrations/market-supabase/client.ts` (linje 16) og injisert via `src/routes/__root.tsx` (linje 14) som `window.__MARKET_SUPABASE_URL`. Det brukes kun til markedsinnsikt/ESCO-data med anon-nøkkel, og inneholder ikke `reg.*`-skjemaet eller regnskap-sync.

Eierskap og tilgang:
- Prosjektet er Lovable Cloud-managed. Det ligger i en Lovable-eid Supabase-organisasjon, ikke i din egen Supabase-org.
- Du kan **ikke** legges til som Owner/Admin på prosjektet fra Lovable-siden, og prosjektet kan ikke overføres til din Supabase-org. Lovable Cloud eksponerer ikke det underliggende prosjektet for eksterne Supabase-kontoer, og service role key / DB-passord er ikke tilgjengelig.
- Praktisk konsekvens: Codex kan ikke koble seg direkte til databasen. Backend-endringer må leveres som PR på main og deployes mekanisk gjennom Lovable (migrasjonsverktøy + Edge-deploy), slik som tidligere PR-er.

Prosjektet nås i produktet via Cloud-fanen (Database, Edge Functions, Secrets). Det finnes ingen Supabase-dashboardlenke å dele for et Cloud-managed prosjekt.

## 2. Miljø som bruker prosjektet

Alle miljøer peker på samme backend — det finnes ingen separat preview-database.

| Miljø | Frontend | Backend |
| --- | --- | --- |
| Production | `https://karrierenmin.no`, `https://www.karrierenmin.no`, `https://mycareer-blank-slate.lovable.app` | `miwzhbludgwvskmsfqnq` |
| Preview | `https://id-preview--4cf3d398-92d8-4618-910c-9be52ac97cf5.lovable.app` | `miwzhbludgwvskmsfqnq` |

- Edge Function base URL: `https://miwzhbludgwvskmsfqnq.supabase.co/functions/v1/` (f.eks. `.../functions/v1/regnskap-sync`)
- `supabase/config.toml` → `project_id = "miwzhbludgwvskmsfqnq"`
- Env-navn i bruk (verdier ikke gjengitt): `SUPABASE_URL`, `SUPABASE_PROJECT_ID`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (kun server), `SUPABASE_DB_URL` (kun Edge Function), `MARKET_SUPABASE_URL`, `MARKET_SUPABASE_ANON_KEY`
- `regnskap-sync` kjører med `verify_jwt = false` og autentiserer i kode (caller-JWT + `has_role`, eller `x-cron-secret`).

## 3. Regnskap-sync status (observert nå, 2026-08-05 ~12:56 UTC)

Feilen er observert i `miwzhbludgwvskmsfqnq`, samme target som over.

Faktisk kjøringsbilde de siste timene (`reg.regnskap_sync_runs`, id 8372–8383, hvert 5. minutt):

```text
status   mode  selected  checked  failed  last_error
partial  due   60        2        2       interval out of range
```

Dette endrer bildet fra det opprinnelige varselet:

- **`select_candidates` timer ikke ut nå.** Hver kjøring velger 60 kandidater og fullfører på ca. 68 sekunder. De 59× 504 / 3× 500 med SQLSTATE 57014 tilhører et tidligere vindu.
- **Den dominerende feilen nå er `interval out of range`** — nøyaktig feilklassen Codex allerede har PR for. Kun 2 av 60 kandidater behandles per kjøring, og begge feiler.
- **Stuck `in_progress` vokser**: 115 rader tidligere i økten, 175 rader nå, eldste lease fra 12:35 UTC. Også dekket av Codex-PR-en.
- Datagrunnlag: `reg.enheter` 439 773 rader, `reg.regnskap_sync_status` 439 602 rader (393 139 `ok`, 175 `in_progress`, 1 `pending`). Kun ~171 enheter mangler statusrad.
- Ad-hoc `EXPLAIN (ANALYZE)` på `due`-spørringen ble kansellert etter >60 s under samtidig cron-last, og databasens connection pool ble metta under diagnosen. Det indikerer at seleksjonen er marginal og sårbar for samtidighet, men den er ikke den aktive blokkeringen akkurat nå.

Konklusjon på tidsrekkefølge: dette er **før** Codex sin backoff/grant/stuck-fix er deployet. Ytelsesfunnet må revurderes **etter** at den PR-en er ute, siden gjennomstrømningen i dag er begrenset av `interval out of range`, ikke av kandidatvalget.

## 4. Handoff til Codex — backend-spesifikasjon

Rekkefølge: deploy eksisterende Codex-PR først, mål på nytt, og gjør ytelsesarbeidet kun hvis det fortsatt trengs.

### Steg A — deploy eksisterende PR (backoff / stuck / grant / edge config)
Etter deploy, la 3–4 cron-sykluser gå og les av:
- `reg.regnskap_sync_runs`: `checked_count` skal nærme seg `selected_count` (forventet ~60, ikke 2)
- `failed_count` og `last_error` skal ikke lenger vise `interval out of range`
- antall `status='in_progress'` i `reg.regnskap_sync_status` skal falle tilbake mot ~0 mellom kjøringer

### Steg B — ytelsesarbeid, kun hvis `select_candidates`-timeout fortsatt observeres
Spesifikasjon (ikke implementert av Lovable):

1. **Målrettede indekser** i `reg` — disse mangler i dag (verifisert mot `pg_indexes`):
   ```sql
   CREATE INDEX IF NOT EXISTS idx_rss_ok_next_attempt
     ON reg.regnskap_sync_status (next_attempt_at) WHERE status = 'ok';
   CREATE INDEX IF NOT EXISTS idx_rss_ok_last_success
     ON reg.regnskap_sync_status (last_success_at) WHERE status = 'ok';
   CREATE INDEX IF NOT EXISTS idx_rss_no_regnskap_checked
     ON reg.regnskap_sync_status (last_checked_at) WHERE status = 'no_regnskap';
   CREATE INDEX IF NOT EXISTS idx_rss_not_found_checked
     ON reg.regnskap_sync_status (last_checked_at) WHERE status = 'not_found';
   ```
   Allerede dekket: `idx_regnskap_sync_status_next_attempt` (pending/retry/due) og `idx_admin_regnskap_sync_status_in_progress`.

2. **Omskriving av `selectCandidates()` for mode `due`** i `supabase/functions/regnskap-sync/db.ts`: erstatt én LEFT JOIN med global `ORDER BY` over ~440k rader med `UNION ALL` av små, indeksvennlige grener (pending/retry/due forfalt; `ok` forfalt på `next_attempt_at`; `ok` eldre enn 180 dager; `no_regnskap`/`not_found` forfalt; utløpte `in_progress`-leases; enheter uten statusrad), hver med egen `ORDER BY ... LIMIT`, deduplisert i ytre spørring. `antall_ansatte`-prioritering beholdes kun i grenen for enheter uten statusrad.

3. **Beskyttelse mot selvforsterkende last**: sett `statement_timeout` per sesjon i `withClient()` (f.eks. 20 s) slik at kandidatvalget feiler raskt i stedet for å holde en pool-connection i over et minutt, og legg en global `pg_try_advisory_lock` i runneren så overlappende 5-minutters cron-kjøringer avbryter tidlig.

4. **Akseptansekriterier**: `EXPLAIN (ANALYZE)` på ny seleksjon under 500 ms; `dryRun`-kjøring med `stage=select_candidates` ok; ingen 504/57014 på `/functions/v1/regnskap-sync` over 6 påfølgende cron-sykluser.

Leveranse som PR mot main med migrasjonsfil + canary-script, deretter mekanisk deploy via Lovable med commit-SHA og SHA-256 for hver fil, som tidligere.
