# NAV upstream-reparasjon og downstream-rekonsiliering — godkjent plan (rev 4 + korrigeringer)

Status: **rev 4 godkjent**. Korrigeringene under er låst og gjelder fra start av implementering.

Implementeringsrekkefølge:

1. Codex bygger og verifiserer upstream Supabase-fasene.
2. Upstream-kontrakter og RPC-er fryses.
3. Lovable bygger target-backfill/catch-up mot de verifiserte kontraktene.
4. Read-only admin-UI bygges sist og kan utsettes.

Ingen Jobb-leads-frontendendringer.

---

## Korrigeringer låst etter rev 4-godkjenning

### K1 — `application_due` er `date` i begge RPC-er

- `list_nav_opportunities_since` kolonne 8: `application_due date` (ikke `timestamptz`).
- `list_nav_opportunities_by_external_ids` samme: `application_due date`.
- **Før DROP** i upstream-migrasjonen: kjør `pg_get_functiondef` mot produksjonssignaturen og diff mot planlagt definisjon. Ved andre avvik mellom planen og produksjon: **stopp migrasjonen og rapporter** før noe endres.

### K2 — Hash dekker hele persistente innholdet

`_nav_compute_payload_hash_row` skal bygge hashgrunnlaget av:

- canonicalized `raw_payload` (per rev 3 §1.3-omfang), pluss
- følgende skalarer fra raden, etter merge: `title`, `company_name`, `location`, `url`, `status`, `published_at`, `expires_at`, `application_due`, `date_modified`, `nav_event_modified_at`.

Normalisering:
- Timestamps → UTC ISO-8601 (`to_char(... AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`).
- `date` → `YYYY-MM-DD`.
- Tekst → trim; `NULL` representeres som JSON `null`, ikke tom streng.

Hashen representerer **ferdig mergede DB-verdier**, ikke bare payloaden. Beregnes alltid etter merge-steget (rev 4 §4).

### K3 — Volatility + grants på `_nav_*`-helpers

- `_nav_safe_to_timestamptz(text)` → **STABLE** (text→timestamptz avhenger av DateStyle/TimeZone).
- `_nav_compute_event_version_row(job_opportunities)` → **STABLE** (kaller `_nav_safe_to_timestamptz`).
- `_nav_canonicalize_payload(jsonb)` → **IMMUTABLE** kun hvis alle operasjoner er deterministiske og timezone-uavhengige; ellers **STABLE**. Default: **STABLE** med mindre vi kan bevise immutability.
- `_nav_compute_payload_hash_row(job_opportunities)` → **STABLE** (avhenger av timestamp-normalisering via STABLE helpers).

Grants for alle `public._nav_*`-funksjoner:

```sql
REVOKE ALL ON FUNCTION public._nav_<name>(...) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._nav_<name>(...) FROM anon;
REVOKE ALL ON FUNCTION public._nav_<name>(...) FROM authenticated;
-- Kun eier + service_role + interne SECURITY DEFINER-funksjoner bruker disse.
GRANT EXECUTE ON FUNCTION public._nav_<name>(...) TO service_role;
```

### K4 — Target-backfill bruker ikke upstream writer-lease

- `nav-backfill-by-ids` **leser** upstream via ID-RPC og **skriver** target. Bruker kun **target run-guard** (`nav_backfill_runs` + target lease om nødvendig).
- Upstream shared writer-lease (`nav_writer`) gjelder **kun** funksjoner som skriver til `public.job_opportunities`: steady, reconcile, upstream detail-enrich.
- Target-backfill skal aldri blokkere upstream steady eller reconcile.

Lease-rekkefølgen i rev 4 §7 gjelder fortsatt for upstream-writers; target-backfill følger en egen, separat target-lease-kontrakt.

### K5 — Audit rollback i reversert rekkefølge

Når flere `source_postings` påvirker samme `canonical_opportunities.live_until`:

- Rollback av status/lifecycle leser `nav_backfill_audit` for berørte canonicals og anvender `previous_*`-verdier i **omvendt** `(applied_at DESC, id DESC)`-rekkefølge.
- Dette gjenoppretter siste konsistente tilstand før kjøringen, uten å bruke en eldre snapshot oppå en nyere endring.
- Payload-rollback skjer fortsatt **kun** via ny source-of-truth-reconcile. Audit lagrer ikke payload-historikk.

---

## Referanse: rev 4-strukturen (uendret med mindre overstyrt over)

- **§1** `list_nav_opportunities_since`: bevart 13-kolonners prefix + 4 nye kolonner (14 `source_event_version`, 15 `source_payload_hash`, 16 `source_event_id`, 17 `changed_at`). Migrasjon: `DROP FUNCTION` med eksakt signatur + `CREATE` i samme txn. Owner/COMMENT/grants/SECURITY DEFINER/search_path bevares verbatim fra produksjon. SELECT-listen er eksplisitt; aldri `b.*`. Input-defaults uendret (`p_since` ingen default, `p_after_external_id text DEFAULT ''`, `p_limit int DEFAULT 500`). LIMIT-kontrakt: `LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000)`.
- **§2** `list_nav_opportunities_by_external_ids`: maks 500 IDer, RAISE 22023 ved >500, returnerer full source-posting-kontrakt inkl. `title/company_name/location/url/published_at/expires_at/application_due/status/date_modified/nav_event_modified_at/raw_payload + source_event_version/source_payload_hash/source_event_id`. EXECUTE kun service_role.
- **§3** Metadata-initialisering: nye kolonner får null som default. Ingen masse-UPDATE. Verdier persisteres kun når raden faktisk endres (insert/merge). Cursor- og ID-RPC bruker `COALESCE(physical, computed_fallback)` via STABLE row-helpers. Timestamp-pathen inkluderer `nav_detail.json.updated`; `raw_payload->>'updated'` brukes ikke. Ugyldig timestamp-streng aborterer aldri batch (`_nav_safe_to_timestamptz` returnerer null).
- **§4** Conditional merge: hash av sluttresultat (se K2). Beslutningstabell: `stale_ignored` / `no_op` / same-version sparse→rik merge / nyere version full merge / insert. Sparse data fjerner aldri rik data.
- **§5** Detail-retry blokkerer ikke closeout. Closeout krever: snapshot komplett, cutoff satt, aktiv writer-lease eid av run_id, feed-tail nådd. `nav_detail_retry_queue` fortsetter separat etter closeout.
- **§6** Audit: kun anvendte endringer i `nav_event_audit` / `nav_backfill_audit`. `no_op` og `stale_ignored` telles i `nav_run_counters`. Target-audit inkluderer `canonical_opportunity_id`, previous/new `live_until`, `posting_status`, `expired_at`, `source_event_version`, `source_payload_hash`.
- **§7** Lease-rekkefølge for upstream writers: claim shared writer-lease → claim mode-/run-lease → heartbeat begge → release i motsatt rekkefølge. Multi-invocation reconcile resumes via `nav_reconcile_runs.run_id`, holder ikke lease mellom Edge-invocations.

---

## Status per fase

- [ ] **Fase 1 (Codex/upstream):** Datamodell + helpers + RPC-er + lease + conditional merge + reconcile + closeout.
- [ ] **Fase 2 (kontraktsfrys):** Codex publiserer endelig RPC-signaturer + sample-respons. Lovable verifiserer mot ID-RPC live før target-arbeid starter.
- [ ] **Fase 3 (Lovable/target):** `nav-backfill-by-ids` Edge-funksjon, target audit/counters, conditional merge target-side, lifecycle catch-up.
- [ ] **Fase 4 (Lovable/frontend, valgfri):** `admin-nav-health` Edge + read-only `/admin/sync`-utvidelse.

Ingen target-arbeid starter før Fase 2 er bekreftet.
