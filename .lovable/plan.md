# Edge-only deploy: regnskap-sync BRREG 500 long backoff

Ingen deploy, test eller endring er utført. Dette er den eneste planen som gjelder nå.

## Hva som skal gjøres

1. **Verifiser filhasher** (read-only, allerede gjort): sammenlign lokale filer mot commit `ba032d19bf8d0a0812dae30f1868d1939fd5b975`.
2. **Kjør Deno-tester** for `regnskap-sync`:
   - `supabase/functions/regnskap-sync/brreg_test.ts`
   - `supabase/functions/regnskap-sync/db_test.ts`
3. **Deploy kun Edge Function `regnskap-sync`** mot project ref `miwzhbludgwvskmsfqnq`.
4. **Observer 3–4 `regnskap-sync-nightly`-ticks** (schedule 13,28,43,58 minutt hver time).

## Hva som IKKE skal gjøres

- Ingen migrasjoner.
- Ingen frontend-endring.
- Ingen cron-schedule-endring.
- Ingen secrets/Vault-endring.
- Ingen opprydding av `cron.job_run_details`.
- Project ref `wcaqfupjatnjwbgatzjv` berøres ikke.

## Rapportering

Per tick rapporteres:
- `run_id`
- `selected_count`
- `checked_count`
- `failed_count`
- `retry_count`
- `stoppedReason`
- `in_progress` antall etter run
- Første 10 orgnr med `http_status = 500`
- `consecutive_failures`, `next_attempt_at`, `backoff_until` for disse orgnr
- Om samme orgnr gjentas på neste tick
- Cron-delivery status

## Forventet resultat

- `checked_count` rundt 60
- `retry_count` lav/0
- BRREG 500-orgnr får `next_attempt_at`/`backoff_until` langt fram i tid
- Samme 500-orgnr skal ikke gjentas på neste tick
- Cron-delivery forblir stabil

## Stoppregel

Stopper ved første reelle deploy- eller testfeil og rapporterer uten workarounds.
