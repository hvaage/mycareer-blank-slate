# M5.7 — Careerjet inn i felles jobbtrakt (rev 3, godkjent for bygg)

Mål: Careerjet leverer inn i samme pipeline som NAV (`source_postings` → `canonical_opportunities` → `user_opportunities` med `card_source='careerjet'`) uten å slette historikk, uten regresjon på NAV, og uten å fjerne dagens brukertrigget Careerjet-flyt før ny cron har vært stabil i ≥7 dager.

## Bekreftet schema (verifisert via psql)

- `opportunity_source_links`: kolonner `link_role text NOT NULL` med CHECK `IN ('primary','variant')`, partial unique `idx_opportunity_source_one_primary ON (canonical_opportunity_id) WHERE link_role='primary'`, og unique `(canonical_opportunity_id, source_posting_id)`. **Bruk `link_role`**, ikke `is_primary`. Ikke ny kolonne.
- `user_opportunities`: unique `(user_id, canonical_opportunity_id)` finnes. **Conflict-target = `(user_id, canonical_opportunity_id)`**. Ingen ny unique nødvendig.

## Prinsipper

- Additivt. Ingen DELETE av `job_leads`, `user_job_listing_status`, `job_listings`, `lead_dedupe_keys`, `applications`, AI-scoring eller `raw_payload`.
- Idempotent. Reruns må aldri lage duplikater eller miste data.
- `posting_status` er sannhet for "expired" — `expired_at` er metadata.
- Gammel `fetch-careerjet-listings` + "Last inn flere"-knapp beholdes parallelt i ≥7 dager etter cron-aktivering.
- NAV-pipelinen røres minimalt.

## Fase 1 — Stabil Careerjet-ID

I `sync-careerjet-opportunities` (kopiert helper, ikke importert fra gammel funksjon):

1. Hvis Careerjet returnerer `jobkey`/`id`: `source_external_id = "cj_id_" + jobkey`.
2. Ellers hvis `url` finnes: normaliser (lowercase, strip `http(s)://`, `?...`, `#...`, trailing `/`, ledende `www.`) → sha256 → `"cj_url_" + hex.slice(0,16)`.
3. Ellers fallback: `"cj_fp_" + sha256(lower(company)|lower(title)|lower(location)|published_at).slice(0,16)`. Logges som warning i `meta.dataIssues` + prefix-teller.

Tom URL kollapser aldri til samme hash. Counter per prefix logges per run.

## Fase 2 — raw_payload merge-helper (eksplisitt, testet)

Ny TS-helper `mergeCareerjetPayload(existing: any, incoming: any, lifecycleEvent?: object): any` i edge-funksjonen, med invarianter:

- **Rik bevares**: for hvert top-level felt i `existing` — hvis `incoming` har null/undefined/""/[], behold `existing` verdi.
- **Hull fylles**: hvis `existing[k]` er null/undefined og `incoming[k]` har verdi → bruk `incoming[k]`.
- **Verdier overskrives bare når begge er ikke-tomme OG `incoming` ser rikere ut** (strenger: lengre; objekter: flere keys; arrays: lengre). Ellers behold `existing`.
- **`careerjet_lifecycle_events` er append-only**: alltid `existing.events ++ (lifecycleEvent ? [lifecycleEvent] : [])`. Aldri trunkert.
- **`previous_*` ikke berørt** av `incoming` — kun lifecycle-helper kan skrive `previous_expired_at` ved reactivation.
- **null `existing`** → returner `{...incoming, careerjet_lifecycle_events: lifecycleEvent ? [lifecycleEvent] : []}`.

Helperen kjøres i edge function før upsert (ikke i SQL) for å holde logikken eksplisitt, lesbar og testbar.

### Innebygd selvtest (dry-run)
Edge function eksponerer `?selftest=1` (admin-only via secret) som kjører fire enhetstester in-memory og returnerer ok/fail per case:
1. existing rik + incoming sparse → existing rike felter bevart.
2. existing sparse + incoming rik → felter beriket.
3. existing med 2 lifecycle_events + ny event → 3 events, kronologisk.
4. existing = null + incoming rik → returnerer incoming + tom events-array.

Selvtesten kjøres i Fase 8 før cron aktiveres og logges i `careerjet_sync_runs.meta.selftest`.

## Fase 3 — Sync-adapter

Ny edge function `sync-careerjet-opportunities` (`verify_jwt=false`, konstant-tids `x-sync-careerjet-secret`, 401 ved feil, `already_running` ved overlapp — samme mønster som NAV).

Per Careerjet-treff:
- Beregn `source_external_id` (Fase 1).
- Hent eksisterende `source_postings`-rad → kjør `mergeCareerjetPayload` → upsert `(source='careerjet', source_external_id)` med `raw_payload`, `posting_status='active'`, `last_seen_at=now()`.
- **Reaktivering** (eksisterende `posting_status='expired'`): sett `posting_status='active'`, `expired_at=NULL`, `reactivated_at=now()`, append lifecycle-event `{event:'reactivated', at:now(), previous_expired_at}`. Bump `rows_reactivated`.
- Upsert `canonical_opportunities` (fingerprint på normalisert employer/title/location).
- Upsert `opportunity_source_links` med `link_role`-regel (Fase 4).

`careerjet_sync_runs`: id, started_at, finished_at, status (`running`/`success`/`partial`/`failed`/`already_running`), cursor_term, cursor_page, rows_fetched/upserted/expired/reactivated/failed, terms_covered, api_errors jsonb, meta jsonb (selftest, dataIssues, prefix-counts), error_summary text.

`partial` = tidsbudsjett uten API-feil. `failed` = timeout/rate-limit/5xx/system. Concurrency-guard identisk med NAV.

## Fase 4 — `opportunity_source_links` (link_role)

Helper-RPC `link_canonical_to_source(p_canonical uuid, p_posting uuid, p_merge_reason text)`:
- Hvis `(canonical, posting)` finnes → return id (idempotent).
- Hvis canonical mangler primary (`NOT EXISTS WHERE link_role='primary'`) → INSERT med `link_role='primary'`.
- Ellers → INSERT med `link_role='variant'`.
- Respekterer `idx_opportunity_source_one_primary` og `opportunity_source_links_unique`. Aldri brutt.

Brukes både fra backfill og live sync.

## Fase 5 — Search terms (hybrid)

Tabell `careerjet_search_terms` (id, term, locale, location, active, priority, last_run_at, source ∈ {`user_keyword`,`user_location`,`curated`}). Per run: union av parsede `profiles.job_search_keywords` + `preferred_locations` (samme parser som NAV) + kuratert fallback (migrasjon-seed). Round-robin via `last_run_at ASC NULLS FIRST`, start 20 termer × 3 sider per run, tidsbudsjett <130 s.

## Fase 6 — Careerjet API (cron-vennlig)

Gammel funksjon sender sluttbrukerens `user_ip`/`user_agent`. Cron har ingen sluttbruker. Krav før cron aktiveres:
- Avklar med affid-eier at konstant `user_agent = "karrierenmin.no careerjet-sync/1.0 (+https://karrierenmin.no)"` og dokumentert server-IP er OK.
- Logg API-status + rate-limit headers per kall i `api_errors`.

Hvis ikke avklart → edge function deployes og testes manuelt, men cron forblir **disabled**.

## Fase 7 — Stale-håndtering

`mark_stale_careerjet_postings(p_days int default 7)`: setter `posting_status='expired'`, `expired_at=now()` for `source='careerjet'`, `posting_status='active'`, `last_seen_at < now() - p_days`. Append lifecycle-event `{event:'expired_by_stale', at, days}`. Returnerer antall expired.

**Kjøres kun etter `status='success'`** og tom `api_errors`. Aldri etter `partial`/`failed`. Dokumentert i admin-view.

`canonical_opportunities.live_until = max(expired_at) + 7 days` settes når alle linkede source_postings har `posting_status IN ('expired','removed')`. Filtre bruker `posting_status`, ikke null-sjekk på `expired_at`.

### Term coverage (sanity)
Admin viser: aktive terms, kjørt siste 24t/7d, eldste `last_run_at`. Warning hvis eldste > 7d.

## Fase 8 — Backfill (ikke-destruktiv, berikende)

`scripts/backfill-careerjet-to-canonical.mjs` (`--dry-run`):
1. Iterer `job_listings WHERE source='careerjet'` og `user_job_listing_status` + join.
2. Beregn `source_external_id` med samme helper.
3. Upsert `source_postings` med `mergeCareerjetPayload(existing, legacyPayload)` — IKKE `DO NOTHING`. Bevarer rik payload, fyller hull, beriker `card_*` via COALESCE.
4. Upsert `canonical_opportunities` via fingerprint.
5. `link_canonical_to_source(...)` (Fase 4).
6. For hver tilknyttet `user_job_listing_status`: upsert `user_opportunities` `ON CONFLICT (user_id, canonical_opportunity_id) DO UPDATE` med COALESCE — bevarer nyere status/AI, kopierer `legacy_listing_*`, setter `card_source='careerjet'`.

Ingen DELETE. `prune_stale_leads` kalles ikke.

## Fase 9 — Matching, RPC, frontend

- Matching i ny sync: mirror NAV-pattern, INSERT `user_opportunities` `ON CONFLICT (user_id, canonical_opportunity_id) DO NOTHING`, `card_source='careerjet'`.
- `list_user_job_opportunities`: Careerjet plukkes opp via canonical-grenen (filter via linked `source_postings.source='careerjet'`). Legg til `raw_payload`-fallback-projeksjon for url/salary/company/date. Bekreft `status::text`-cast i alle union-grener. Legacy-grenen beholdes for stragglers.
- Frontend `/job-leads`: bekreft badge + lenker, behold "Last inn flere"-knapp.

## Fase 10 — Promote/dismiss

NAV-mønster, begge kilder. Promote → `applications` + `user_opportunities.status='applied'` (+ speil til `user_job_listing_status` UPDATE-only). Dismiss → `user_opportunities.status='dismissed'`. INGEN sletting. `prune_stale_leads` urørt (teknisk gjeld).

## Fase 11 — Admin

Ny `/admin/sync` med tabs **NAV** | **Careerjet**. `/admin/nav-sync` → redirect `/admin/sync?tab=nav` (alias bevares). Read-only.

Careerjet-tab: 50 siste runs (duration, status-badges OK/SLOW>130s/FAILED/PARTIAL/STUCK/ALREADY_RUNNING), fetched/upserted/expired/reactivated/failed, `api_errors`-sammendrag, duplikater på `(source, source_external_id)`, missing `raw_payload` for active, prefix-counts (cj_id_/cj_url_/cj_fp_), term coverage, selftest-status.

Admin-RPCs (SECURITY DEFINER, alle `has_role(...,'admin')`):
`get_careerjet_sync_cron_info`, `careerjet_sync_vault_has_secret`, `careerjet_sync_duplicate_external_ids`, `careerjet_sync_distinct_external_count`, `careerjet_sync_count_missing_raw_payload`, `careerjet_sync_last_seen_stats`, `careerjet_sync_term_coverage`, `careerjet_sync_external_id_prefix_counts`.

## Fase 12 — Secrets og cron

Eksisterende: `CAREERJET_AFFID`. Nye: `SYNC_CAREERJET_SECRET` (add_secret) + Vault `sync_careerjet_secret`. Cron `careerjet-sync-60min` (60-min, `net.http_post` med header fra Vault) **opprettes DISABLED** ved migrasjon. Aktiveres manuelt etter Fase 13.

## Fase 13 — Verifisering før cron aktiveres

Kjør 3 manuelle syncs + 1 selftest, rapporter:
- run id, duration, status, cursor før/etter
- fetched/upserted/expired/reactivated/failed
- `source_postings` count + prefix-fordeling
- duplicate count på `(source='careerjet', source_external_id)` (forventet 0)
- raw_payload non-null for active (forventet 100 %)
- selftest-resultater (4/4 pass)
- `user_opportunities` med `card_source='careerjet'`
- Testbruker får Careerjet-rad i `list_user_job_opportunities('all','careerjet')`
- Promote/dismiss sletter ingen underliggende data
- NAV-pipelinen fortsatt grønn
- Backfill dry-run + live, diff
- Careerjet API cron-bruk avklart

Først når ALT er grønt → cron aktiveres manuelt.

## Fase 14 — Pensjonering (etter ≥7d stabil)

Vurder: skjule "Last inn flere", deaktivere `fetch-careerjet-listings` (ikke slette), migrere `prune_stale_leads` til tombstone.

## Tekniske detaljer

Migrasjoner (separate):
- `careerjet_sync_runs` + GRANTs + RLS admin-read
- `careerjet_search_terms` + GRANTs + RLS admin + curated seed
- Verifiser `source_postings.last_seen_at`, legg til `reactivated_at` ved behov
- RPC `mark_stale_careerjet_postings(p_days int)`
- RPC `link_canonical_to_source(...)`
- Admin-RPCs (Fase 11)
- Oppdatert `list_user_job_opportunities` (raw_payload-projeksjon, status::text overalt)
- Cron `careerjet-sync-60min` DISABLED

Edge function `sync-careerjet-opportunities`: selvstendig, kopierte helpers (hash, keyword-parser, `mergeCareerjetPayload` + selftest). `verify_jwt=false`.

Scripts: `scripts/backfill-careerjet-to-canonical.mjs` med `--dry-run`.

## Avgrensninger

Ingen syntetisk testdata mot Careerjet-API. Ingen aggressiv NAV-refactor. LinkedIn → M5.8. Ingen sletting av historikk.

## Åpne spørsmål (kan besvares under bygg)

1. Per-run budsjett: 20 termer × 3 sider trygt < 130 s? Justeres etter første 3 runs.
2. Kuraterte fallback-termer: migrasjon-seed (default) eller edge-konstant?
3. Careerjet API cron-bruk OK med affid-avtalen?
