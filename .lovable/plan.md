# M5.6 — NAV inn i felles jobb-trakt (final v5)

Innarbeider de 2 siste drifts-presiseringene på toppen av v4. Hovedinvarianter uendret:
- NAV-rader slettes ALDRI.
- ACTIVE nav_detail kan oppdateres; INACTIVE rører aldri nav_detail.
- Cursor flyttes kun forbi rader som er varig prosessert.
- **NYTT v5**: cursor leses kun fra ferdige run-er; overlappende sync-runs blokkeres.

## Forutsetninger i `norwegian-career-intelligence` (manuelt, uendret fra v4)
- `nav-feed/index.ts`: aldri DELETE ved INACTIVE — bevar `raw_payload.nav_detail`.
- RPC `public.list_nav_opportunities_since(p_since timestamptz, p_after_external_id text, p_limit int)` SECURITY DEFINER, GRANT kun service_role. Returnerer ACTIVE+INACTIVE med `changed_at = greatest(updated_at, date_modified, nav_event_modified_at, imported_at)`, sortert `(changed_at asc, external_id asc)`.

## Secrets
`NAV_SOURCE_SUPABASE_URL`, `NAV_SOURCE_SERVICE_ROLE_KEY`, `SYNC_NAV_SECRET` (+ Vault `sync_nav_secret`), valgfritt `NAV_SYNC_AI_MODEL`. `LOVABLE_API_KEY` finnes.

## App-migrasjon `M56_nav_canonical_feed` (idempotent)

### Schema (uendret fra v4)
```sql
ALTER TABLE public.source_postings
  ADD COLUMN IF NOT EXISTS posting_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS expired_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='source_postings_posting_status_chk'
      AND conrelid='public.source_postings'::regclass
  ) THEN
    ALTER TABLE public.source_postings
      ADD CONSTRAINT source_postings_posting_status_chk
      CHECK (posting_status IN ('active','expired','removed')) NOT VALID;
    ALTER TABLE public.source_postings VALIDATE CONSTRAINT source_postings_posting_status_chk;
  END IF;
END $$;

ALTER TABLE public.canonical_opportunities ADD COLUMN IF NOT EXISTS live_until timestamptz;
ALTER TABLE public.user_opportunities ADD COLUMN IF NOT EXISTS card_source text;
```

### `nav_sync_runs` med run-state og lock-felt
```sql
CREATE TABLE IF NOT EXISTS public.nav_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,                                -- NULL = pågående
  fetched int NOT NULL DEFAULT 0,
  upserted int NOT NULL DEFAULT 0,
  expired int NOT NULL DEFAULT 0,
  reactivated int NOT NULL DEFAULT 0,
  matched_user_opps int NOT NULL DEFAULT 0,
  scored int NOT NULL DEFAULT 0,
  error_summary text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb                 -- {cursor_changed_at, cursor_external_id, model, errors, dataIssues, systemErrors, aiErrors, prev_run_id}
);

-- Indeks for raskt oppslag av "siste ferdige" og "pågående".
CREATE INDEX IF NOT EXISTS nav_sync_runs_finished_idx
  ON public.nav_sync_runs (finished_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS nav_sync_runs_unfinished_idx
  ON public.nav_sync_runs (started_at DESC) WHERE finished_at IS NULL;

GRANT SELECT ON public.nav_sync_runs TO authenticated;
GRANT ALL ON public.nav_sync_runs TO service_role;
ALTER TABLE public.nav_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nav_sync_runs_admin_read ON public.nav_sync_runs;
DO $$
DECLARE has_role_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='has_role'
  ) AND EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname='public' AND t.typname='app_role'
  ) INTO has_role_ok;
  IF has_role_ok THEN
    EXECUTE $p$CREATE POLICY nav_sync_runs_admin_read ON public.nav_sync_runs
              FOR SELECT TO authenticated
              USING (public.has_role(auth.uid(),'admin'::public.app_role))$p$;
  ELSE
    RAISE NOTICE 'has_role/app_role missing; nav_sync_runs has no authenticated SELECT policy';
  END IF;
END $$;
```

### RPC `list_user_job_opportunities` (uendret fra v4)
SECURITY DEFINER, GRANT EXECUTE TO authenticated. Tre union-grener (canonical NAV+Careerjet, legacy Careerjet, LinkedIn). `p_source IN ('nav','careerjet')` filtrerer canonical via `EXISTS` på linked source_postings.source, ikke kun display-source. Returnerer `source text`, `sources text[]`, `is_expired boolean`. Karens: `live_until IS NULL` eller `> now()` → synlig; etter `live_until` skjult unntatt `p_status='all-history'`. `NOTIFY pgrst, 'reload schema'` etter create.

`list_user_careerjet_leads` uendret (cover-letters.tsx).

## Edge Function `supabase/functions/sync-nav-opportunities/index.ts`

`supabase/config.toml`:
```toml
[functions.sync-nav-opportunities]
verify_jwt = false
```

**Auth:** krever `x-sync-nav-secret`. Lokal `timingSafeEqualStr` (samme mønster som `regnskap-sync/index.ts`). 401 ved feil. Aldri logg secret.

### Pipeline med strikt run-state-disiplin

**Steg 0 — Concurrency-guard (P2 nytt):**
```ts
// Sjekk for unfinished run nyere enn 60 min (stale-timeout).
const { data: inflight } = await admin
  .from('nav_sync_runs')
  .select('id, started_at')
  .is('finished_at', null)
  .gte('started_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
  .order('started_at', { ascending: false })
  .limit(1)
  .maybeSingle();

if (inflight) {
  return json({ ok: true, status: 'already_running', inflight_run_id: inflight.id, started_at: inflight.started_at }, 200);
}
// Stale runs (>60 min) ignoreres stille; markeres ikke aborted her.
```

Eldre unfinished runs (>60 min) regnes som stale og blokkerer ikke. De forblir med `finished_at=NULL` og `error_summary` settes ikke av denne runen (de telles ikke som "siste vellykkede").

**Steg 1 — Les cursor FØR ny rad opprettes (P1 nytt):**
```ts
const { data: lastDone } = await admin
  .from('nav_sync_runs')
  .select('id, meta')
  .not('finished_at', 'is', null)
  .is('error_summary', null)
  .order('finished_at', { ascending: false })
  .limit(1)
  .maybeSingle();

const cursorChangedAt = lastDone?.meta?.cursor_changed_at ?? new Date(Date.now() - 7*24*3600*1000).toISOString();
const cursorExternalId = lastDone?.meta?.cursor_external_id ?? '';
const prevRunId = lastDone?.id ?? null;
```
Filter `finished_at IS NOT NULL AND error_summary IS NULL` garanterer at en in-progress rad aldri leses som siste vellykkede.

**Steg 2 — Opprett `nav_sync_runs`-rad** (`started_at=now()`, `finished_at=NULL`, `meta={cursor_changed_at, cursor_external_id, model, prev_run_id}`). Lagre `runId` for finally-oppdatering.

**Steg 3 — Hent NAV** via `list_nav_opportunities_since(cursorChangedAt, cursorExternalId, batchLimit)`. Maks 4000/run.

**Steg 4 — Per rad, to feilklasser:**
- **Non-retryable datakvalitetsfeil** (mangler title/employer/external_id): logg i `meta.dataIssues[]`, cursor passerer raden.
- **Systemfeil** (DB/RPC/fingerprint/canonical/source_postings upsert): logg i `meta.systemErrors[]`, **stopp prosessering**. Cursor i meta forblir på siste varig prosesserte rad (eller forrige cursor hvis ingen rad ble fullført). `error_summary='system_error: ...'`. Neste run retryer fra samme punkt.
- **AI-feil** per-rad: `meta.aiErrors[]`, ikke-blokkerende, cursor uberørt.

**Steg 5 — Finally:** UPDATE `nav_sync_runs` SET `finished_at=now()`, tellere, `meta` (med endelig cursor), `error_summary` (NULL ved suksess, satt ved systemfeil).

### raw_payload merge (uendret fra v4)
ACTIVE: ny `nav_detail` vinner; forrige bevares i `previous_nav_detail`. INACTIVE: bevar eksisterende `nav_detail`, legg kun til `nav_inactive_event` + `last_nav_status='INACTIVE'`.

### Upsert-logikk (uendret fra v4)
- **ACTIVE:** upsert source_posting (merget payload, `posting_status='active'`, `expired_at=NULL`, `last_seen_at=now()`). Reaktivering bumper `reactivated`. Upsert canonical_opportunities, opportunity_source_links. `live_until=NULL`.
- **INACTIVE:** UPDATE source_posting → `posting_status='expired'`, `expired_at=COALESCE(expired_at, now())`. Per canonical: hvis alle linked source_postings er expired/removed → `live_until = max(expired_at) + 7 days`.
- **Aldri DELETE.** `safeUrl` fallback `'https://arbeidsplassen.nav.no/stillinger/stilling/' + external_id`.

### Per-user matching og AI (uendret fra v4)
Kun ACTIVE canonical. Match via `profiles.job_search_keywords` + `preferred_locations`. INSERT user_opportunities ON CONFLICT DO NOTHING med `card_source='nav'`. AI ≤20 nye uten `ai_scored_at`, modell fra `NAV_SYNC_AI_MODEL` (default `google/gemini-2.5-flash`), per-row try/catch.

## Cron-migrasjon (separat, uendret fra v4)
Unschedule `nav-sync-30min`, re-schedule via `net.http_post` med `x-sync-nav-secret` fra Vault. Cron-frekvens 30 min er fortsatt OK fordi concurrency-guarden returnerer `already_running` ved overlapp.

## UI — `src/routes/_authenticated/job-leads.tsx` (uendret fra v4)
Bytt til `list_user_job_opportunities`. NAV: dismiss/save/apply oppdaterer `user_opportunities.status`; **ALDRI DELETE**. Careerjet/LinkedIn-flyt urørt. Apply disabled når `is_expired`.

## Verifisering

1. Build grønn.
2. POST uten `x-sync-nav-secret` → 401, ingen secret i logg.
3. Cron 1: ny ferdig run-rad med `finished_at` satt, `error_summary IS NULL`.
4. Cron 2 samme data: 0 nye, cursor avansert; leser cursor fra cron-1 (ikke fra in-progress).
5. **Concurrency (P2):** start sync-1, før den fullføres trigge sync-2 manuelt → sync-2 returnerer `{status:'already_running', inflight_run_id}`, ingen ny rad opprettet, ingen NAV-fetch.
6. **Stale lock:** simuler `started_at = now()-90min`, `finished_at=NULL` → ny run starter normalt.
7. **Cursor-isolasjon (P1):** mens sync-1 kjører, sjekk at sync-1s nye rad ikke ble brukt som "siste vellykkede" — bekreft ved at `meta.prev_run_id` peker på forrige fullførte run.
8. ACTIVE oppdatering rikere nav_detail: nytt nav_detail lagret, forrige i `previous_nav_detail`.
9. INACTIVE: `posting_status='expired'`, `live_until=expired_at+7d`, `raw_payload.nav_detail` uendret, `nav_inactive_event` lagt til.
10. Reaktivering: `posting_status='active'`, `expired_at=NULL`, `live_until=NULL`, `reactivated≥1`.
11. RPC `('new','nav')` returnerer canonical med NAV source_posting selv om `primary_source='careerjet'`.
12. Karens: `is_expired=true` 7d; skjult etter `live_until` uten `all-history`.
13. UI promote/dismiss NAV → `applications` opprettet / `status='applied'|'dismissed'`, rad finnes fortsatt.
14. Simulert DB-feil midt i batch → `error_summary='system_error:...'`, cursor uendret, neste run retryer; den feilede runen brukes ikke som siste vellykkede.
15. Datakvalitetsfeil: logget i `meta.dataIssues`, cursor passerer.
16. AI-feil per rad: `meta.aiErrors[]`, run grønn.
17. `list_user_careerjet_leads` uendret.

## Out of scope
`fetch-careerjet-listings`, `search_employers`, `regnskap-sync`, mail, ny scraping, NAV-kall fra frontend, sletting av historiske rader, endringer i `cover-letters.tsx`.
