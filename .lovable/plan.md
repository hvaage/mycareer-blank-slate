# Edge-only deploy: regnskap-sync BRREG 500 long backoff

Preflight er utført (read-only). Ingenting er deployet, kjørt eller endret ennå.

## Preflight — verifisert

Lokal HEAD: `ba032d1` (Merge pull request #29 from hvaage/codex/regnskap-sync-brreg-500-backoff) — matcher `ba032d19bf8d0a0812dae30f1868d1939fd5b975`.

SHA-256, alle 6 filer matcher forventet verdi:

| Fil | Status |
| --- | --- |
| `supabase/functions/regnskap-sync/db.ts` | OK `2753f366…4339` |
| `supabase/functions/regnskap-sync/db_test.ts` | OK `d226b3dd…0d9e` |
| `supabase/functions/regnskap-sync/brreg.ts` | OK `ad66f8e9…06ea` |
| `supabase/functions/regnskap-sync/brreg_test.ts` | OK `3d0a6253…6166f` |
| `supabase/functions/regnskap-sync/runner.ts` | OK `00ca4d91…6dc8` |
| `supabase/functions/regnskap-sync/_stage.ts` | OK `d88f29ac…5d69` |

Endringens kjerne, lest fra koden: `shouldRetryImmediately(500)` er nå `false` (BRREG 500 retries ikke i samme kjøring), og `retryBackoffMinutes` gir 500-svar en egen lang kø-backoff: 6 t → 24 t → 7 d, capped på 7 d.

## Utførelse (etter godkjenning)

1. **Deno-tester først** — `brreg_test.ts` + `db_test.ts` via test-runneren. Stopp ved feil.
2. **Deploy kun Edge Function `regnskap-sync`** mot ref `miwzhbludgwvskmsfqnq`. Ingen migrasjoner, ingen cron-endring, ingen secrets, ingen frontend, ingen `cron.job_run_details`-opprydding. `wcaqfupjatnjwbgatzjv` berøres ikke.
3. **Observer 3–4 `regnskap-sync-nightly`-ticks** (schedule 13,28,43,58 → ca. 15 min mellom hver, så ~45–60 min observasjonsvindu).

## Rapportering

Per tick, lest read-only fra `reg.regnskap_sync_runs` og `reg.regnskap_sync_status`:

- `run_id`, `selected_count`, `checked_count`, `failed_count`, `retry_count`, `stoppedReason`
- antall `status='in_progress'` etter run
- første 10 orgnr med `http_status = 500`
- for de samme orgnr: `consecutive_failures`, `next_attempt_at`, `backoff_until`
- eksplisitt sjekk på om de samme 500-orgnr dukker opp igjen på neste tick
- cron-delivery-status (`status_code` per dispatch)

Måles mot forventningen: `checked_count` ~60, `retry_count` lav/0, 500-orgnr skjøvet langt fram, ingen gjentakelse neste tick, stabil cron-delivery.

## Stoppregel

Stopper ved første reelle deploy- eller testfeil og rapporterer uten å forsøke workarounds.
