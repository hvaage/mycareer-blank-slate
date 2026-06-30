# Lovable-instruksjon: Admin-innsyn for register- og NAV-nedlastinger

## Scope

Lag kun frontend/read-only adminvisning i karrierenmin.no. Backend-kontrakten er allerede levert av Codex i Supabase-migrasjonen:

- `supabase/migrations/20260627120000_admin_ingestion_status.sql`
- RPC: `public.get_admin_ingestion_status(p_days integer default 14, p_timezone text default 'Europe/Oslo')`

Lovable skal ikke endre Supabase, Edge Functions, cron, Vault, secrets eller sync-logikk.

## Hvor visningen skal ligge

Legg dette under Admin, helst som en ny tab/side:

- `/admin/ingestion` eller en ny tab i eksisterende `/admin/sync`
- Label: `Datainntak`
- Kun knapp/ikon for refresh. Ingen knapper som starter repair, sync, cron eller backfill.

## Datakall

Kall RPC-en read-only:

```ts
const { data, error } = await supabase.rpc("get_admin_ingestion_status", {
  p_days: 14,
  p_timezone: "Europe/Oslo",
});
```

Hvis direkte klient-RPC feiler på rettigheter i miljøet, lag en TanStack server function som først sjekker adminrollen og deretter kaller samme RPC server-side. Ikke flytt tellingene inn i frontend.

## JSON-kontrakt

Viktige felter:

- `generated_at`
- `timezone`
- `window.days`, `window.from_date`, `window.to_date`
- `brreg.enhetsregisteret.downloaded_total`
- `brreg.enhetsregisteret.downloaded_active`
- `brreg.enhetsregisteret.downloaded_counts_are_estimates`
- `brreg.enhetsregisteret.remaining_upstream`
- `brreg.enhetsregisteret.remaining_reason`
- `brreg.regnskapsregisteret.companies_with_min_1_year`
- `brreg.regnskapsregisteret.companies_with_min_1_year_in_enhetsregisteret`
- `brreg.regnskapsregisteret.remaining_against_local_enhetsregisteret`
- `brreg.regnskapsregisteret.remaining_estimate_kind`
- `brreg.regnskapsregisteret.rows_total_is_estimate`
- `brreg.regnskapsregisteret.companies_count_basis`
- `brreg.regnskap_sync.due_now_estimate`
- `brreg.regnskap_sync.by_status`
- `brreg.regnskap_sync.latest_run`
- `nav.active_unique_postings`
- `nav.active_unique_postings_is_estimate`
- `nav.new_unique_postings_window`
- `nav.daily_new_unique_postings[]`
- `nav.latest_run`
- `nav.daily_definition`

## UI-krav

Vis øverst:

- Sist oppdatert: `generated_at`
- Vindu: `window.from_date` til `window.to_date`
- Refresh-knapp

Lag tre seksjoner:

1. `Brønnøysund - Enhetsregisteret`
   - Kort: `Nedlastede enheter` = `downloaded_total`
   - Kort: `Aktive i lokalt speil` = `downloaded_active`
   - Hvis `downloaded_counts_are_estimates` er true, merk tallene diskret som `Estimat`.
   - Kort: `Gjenstår` = `remaining_upstream ?? "Ukjent"`
   - Undertekst når ukjent: bruk `remaining_reason`

2. `Brønnøysund - Regnskapsregisteret`
   - Kort: `Selskap med minst 1 års regnskap` = `companies_with_min_1_year`
   - Kort: `Koblet til enhetsspeil` = `companies_with_min_1_year_in_enhetsregisteret`
   - Kort: `Gjenstår mot lokalt enhetsspeil` = `remaining_against_local_enhetsregisteret`
   - Hvis `rows_total_is_estimate` er true, merk `rows_total` diskret som `Estimat` der det vises.
   - Vis liten forklaring fra `remaining_explanation`, fordi noen enheter legitimt kan mangle offentlig årsregnskap.
   - Vis statuschips fra `regnskap_sync.by_status`, samt `due_now_estimate`, `failed_or_retry`, `in_progress_stuck`.
   - Vis siste run med status, checked, OK, no_regnskap, failed og duration.

3. `NAV jobbannonser`
   - Kort: `ACTIVE annonser` = `active_unique_postings`
   - Hvis `active_unique_postings_is_estimate` er true, merk tallet diskret som `Estimat`.
   - Kort: `Nye unike i valgt vindu` = `new_unique_postings_window`
   - Diagram/tabell per døgn fra `daily_new_unique_postings`, nyeste dato først.
   - Vis siste NAV-run med mode, fetched, upserted, expired, reactivated, noop, stale og error.
   - Forklaring i liten tekst: bruk `daily_definition`.

## Viktige grenser

- Ikke rapporter “runtime PASS” hvis du bare har inspisert kode.
- Ikke lag muterende adminhandlinger.
- Ikke slett eller arkiver jobbannonser, source_postings, regnskap eller raw payload.
- Ikke beregn NAV dagstall fra `nav_sync_runs.upserted`; bruk RPC-feltet `daily_new_unique_postings`, fordi det teller faktisk nye unike `source_external_id` etter første innsetting.
- Ikke presenter Brønnøysund “gjenstår” som absolutt upstream-sannhet. Feltet `remaining_against_local_enhetsregisteret` er et lokalt estimat mot speilet.
