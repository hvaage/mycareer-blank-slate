## M5.2 fallback rev 2: Edge Function-runner + QA i Edge Function

### Bakgrunn
TanStack-runtime har ikke `SUPABASE_DB_URL`. `reg.*` er ikke eksponert i Data API og skal ikke eksponeres. Derfor må både runneren og QA-verifiseringen kjøre i Edge Function der `SUPABASE_DB_URL` finnes.

### Scope
- Edge Function `supabase/functions/regnskap-sync/index.ts` (runner + QA-mode)
- Admin-QA-side kaller funksjonen med caller-JWT (innlogget admin-session)
- Ingen cron, ingen UI utover eksisterende admin-QA-side
- Ingen anon/authenticated grants på `reg.*`, ingen Data API-eksponering av reg
- Ingen MV-refresh, ingen raw_data, ingen storage
- Midlertidig QA-side/funksjon slettes etter M5.2-lukking

---

### Filendringer

**Nye filer:**
- `supabase/functions/regnskap-sync/index.ts` — entrypoint. POST only, `verify_jwt=true`, admin-sjekk via `has_role(auth.uid(),'admin')` med caller-token. Router for `op: 'run' | 'qa'`.
- `supabase/functions/regnskap-sync/runner.ts` — orchestrator (claim → fetch → normalize → upsert → status → run/run_items)
- `supabase/functions/regnskap-sync/db.ts` — `deno-postgres`-pool via `SUPABASE_DB_URL`. Inneholder claim-SQL (Step A/B/C) og QA-verifikasjonsqueries mot `reg.*`.
- `supabase/functions/regnskap-sync/brreg.ts` — fetch fra BRREG
- `supabase/functions/regnskap-sync/normalize.ts` — normalisering (port av `src/lib/regnskap-sync.normalize.ts`)
- `supabase/functions/regnskap-sync/qa.ts` — QA-sekvens: real → re-run + verifikasjon, returnerer aggregert resultat
- `supabase/functions/regnskap-sync/normalize_test.ts` — Deno-port av normalize-testene

**Endrede filer:**
- `src/routes/_authenticated/admin.regnskap-qa.tsx` — bytt `useServerFn(runRegnskapSyncQA)` med `supabase.functions.invoke('regnskap-sync', { body: { op: 'qa', orgnrs: [...] } })` direkte fra klienten (admin-session JWT sendes automatisk). UI viser kun returnert QA-resultat.
- `supabase/config.toml` — `[functions.regnskap-sync]` med `verify_jwt = true`

**Slettes etter M5.2-lukking:**
- `src/lib/regnskap-sync-qa.functions.ts`
- `src/lib/regnskap-sync-env.functions.ts`
- `src/routes/_authenticated/admin.regnskap-qa.tsx`
- `src/lib/regnskap-sync.server.ts`, `regnskap-sync.db.server.ts`, `regnskap-sync.brreg.ts`, `regnskap-sync.normalize.ts` + tester/snap (én sannhetskilde i Edge Function)

---

### Edge Function-kontrakt

`POST /functions/v1/regnskap-sync` — `verify_jwt=true`, caller-JWT (admin-session). **Aldri service-role som auth-token.**

**Body (run):**
```json
{
  "op": "run",
  "mode": "orgnrs" | "due" | "all-missing" | "catchup",
  "orgnrs": ["..."],
  "limit": 50,
  "rps": 2.0,
  "timeBudgetMs": 50000,
  "dryRun": false
}
```

**Body (qa):**
```json
{ "op": "qa", "orgnrs": ["923609016","976239997","984851006","929877950","984661185"] }
```

**Handler-flyt:**
1. Verifiser JWT (automatisk via `verify_jwt`)
2. `supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' })` med caller-token → 403 hvis ikke admin
3. Først etter admin-sjekk: åpne Postgres-pool mot `SUPABASE_DB_URL` og kjør jobben

---

### Claim-logikk (lease-modell fra M5.1, uendret)

Ingen `locked_by`/`locked_at` — bruk eksisterende kolonner:

- **Step A** — kandidater fra `reg.enheter` LEFT JOIN `reg.regnskap_sync_status`, filtrert på `status IS NULL OR status='pending' OR status='failed' OR (status='in_progress' AND last_checked_at < now() - interval '10 minutes')` (utløpt lease) OR (due basert på `last_success_at`).
- **Step B** — `INSERT INTO reg.regnskap_sync_status (organisasjonsnummer, status) SELECT ... ON CONFLICT DO NOTHING`.
- **Step C** — claim med re-sjekk i WHERE etter låsing:
  ```sql
  UPDATE reg.regnskap_sync_status
     SET status='in_progress', last_checked_at=now(), attempts=attempts+1
   WHERE organisasjonsnummer = ANY($1)
     AND (
       status IN ('pending','failed')
       OR (status='in_progress' AND last_checked_at < now() - interval '10 minutes')
       OR last_success_at IS NULL
       OR last_success_at < now() - interval <due-window>
     )
   RETURNING organisasjonsnummer;
  ```
  Re-sjekken i WHERE forhindrer at to parallelle runs claimer samme orgnr — andre run får tom RETURNING for raden.

---

### QA-sekvens (op='qa')

For de 5 faste orgnr (`923609016, 976239997, 984851006, 929877950, 984661185`):

1. **Snapshot before:** `attempts`, `hentet_tidspunkt`, `status` per orgnr
2. **Run real:** `runner({ mode:'orgnrs', orgnrs, dryRun:false, rps:2.0, timeBudgetMs:50000 })`
3. **Snapshot mid:** lagre `hentet_tidspunkt` per orgnr etter første real run
4. **Re-run real:** samme parametre
5. **Snapshot after:** `attempts`, `hentet_tidspunkt`, `status`

**Verifikasjon (alle via SUPABASE_DB_URL i Edge Function):**
- `reg.regnskap` har rader for orgnr
- `attempts_after - attempts_before == 2` per orgnr (delta, ikke absolutt)
- `hentet_tidspunkt` uendret mellom mid og after (re-run skal ikke bumpe når data er uendret)
- `raw_data IS NULL` på alle rader for orgnr
- `reg.regnskap_sync_runs` har **2 nye runs** (real + re-run) etter QA — dryRun skrives ikke til DB
- `reg.regnskap_sync_run_items` har rader for begge runs

**Retur til UI:** `{ before, after, runs, runItems, deltaAttempts, hentetTidspunktUnchanged, rawDataAllNull, ok: boolean }`.

---

### M5.2-lukking (etter grønn QA)

1. Slett `admin.regnskap-qa.tsx`, `regnskap-sync-qa.functions.ts`, `regnskap-sync-env.functions.ts`
2. Slett `src/lib/regnskap-sync.*` (runner-kopier i TanStack)
3. `rg` for å bekrefte at `_qa-regnskap`, `regnskap-sync-qa`, `regnskap-sync-env`, `regnskap-sync.server`, `regnskap-sync.db.server` er borte
4. Behold Edge Function `supabase/functions/regnskap-sync/` (produksjonsflate for fremtidig cron)
5. Kjør build/typecheck/tester

---

### Klart til build
Klar til å bygge mot denne planen.
