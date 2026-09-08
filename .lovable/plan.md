# Forhåndskontroll før AI-integrasjonsmigrasjon (kun lesing)

Ingen endringer er gjort: ingen migrasjon, ingen kode, ingen publisering, ingen jobber stanset.

## 1. Tilbakeføring, backup og transaksjon

| Spørsmål | Svar |
| --- | --- |
| Omfatter «gå tilbake til et tidligere punkt» databasen? | Nei. Den gjenoppretter kun applikasjonskode/filer. |
| Gjenopprettes tabeller, kolonner, indekser, funksjoner, triggere, grants, RLS? | Nei. Databaseskjema forblir slik det er etter siste migrasjon. |
| Gjenopprettes data endret/slettet etterpå? | Nei. |
| Kan jeg lage en verifiserbar backup før migrasjon? | Delvis. Jeg kan eksportere skjemadefinisjoner (tabeller, indekser, funksjoner, triggere, policyer) og CSV-eksport av navngitte tabeller/spørringer til fil. Full databasedump er ikke tilgjengelig herfra; komplett eksport gjøres av deg i Cloud → Advanced settings → Export data. |
| Kan hele SQL-migrasjonen kjøres i én transaksjon med rollback ved feil? | Ja, forutsatt at migrasjonen ikke bruker `CREATE INDEX CONCURRENTLY`, `VACUUM`, `CREATE DATABASE` eller endringer i pg_cron-jobber som må committes underveis. Alle planlagte objekter (5 tabeller, 9 indekser, 2 triggere, policyer, grants) er transaksjonssikre i PostgreSQL. |

## 2. Lesende kontroller

| Kontroll | Resultat | Status |
| --- | --- | --- |
| Prosjekt/database bekreftet | Prosjektets konfigurerte Lovable Cloud-database (samme instans som preview og publisert app), PostgreSQL 17.6 | PASS |
| `public.email_job_sources` finnes | Ja | PASS |
| Kolonnene `user_id` og `intake_mode` | Begge finnes | PASS |
| `public.update_updated_at_column()` | Finnes, ingen argumenter, returnerer `trigger` | PASS |
| De 5 planlagte AI-tabellene finnes fra før | Ingen av dem finnes | PASS (ingen kollisjon) |
| De 9 planlagte indeksnavnene | Ingen finnes | PASS |
| Triggernavn `set_ai_integrations_updated_at`, `set_automation_preferences_updated_at` | Ingen finnes | PASS |
| Policy-navn på de 5 tabellene | Ingen finnes (tabellene finnes ikke) | PASS |
| Duplikater `intake_mode = 'forwarding'` per bruker | 0 berørte brukere, høyeste duplikatantall 0 | PASS (unik indeks kan opprettes uten opprydding) |
| `gen_random_uuid()` tilgjengelig | Ja. `pgcrypto` 1.3 og `uuid-ossp` 1.1 i `extensions`-skjemaet; PG17 har `gen_random_uuid()` innebygd | PASS |
| Migrasjonsregister (siste 5 versjoner) | 20260907065414, 20260907065308, 20260903132533, 20260903125733, 20260903122434 | PASS (uendret) |

Ingen FAIL. Ingen blokkeringer funnet for de planlagte objektene.

## 3. Aktive jobber som må vurderes stanset under migrasjonen

Aktive: `nav-sync-30min` (*/30), `careerjet-sync-6h`, `rydd-cron-logg` (04:00), `regnskap-sync-15min` (13,28,43,58), `ops-watchdog-hourly`, `brreg-enheter-full-start` (1. og 15. kl. 03), `brreg-enheter-full-driver` (*/5 den 1.–3./15.–17.), `network-suggestions-worker-1min` (hvert minutt), `network-suggestions-reaper-5min`, `careerjet-purge-60d` (03:20).

Allerede inaktive: `linkedin-import-worker`, `linkedin-import-reaper`.

Anbefalt stansliste før migrasjon (minutt-/femminuttsjobber som holder lange transaksjoner eller skriver tungt): `network-suggestions-worker-1min`, `network-suggestions-reaper-5min`, `regnskap-sync-15min`, `brreg-enheter-full-driver`, `nav-sync-30min`. Øvrige jobber kan stå så lenge migrasjonen ikke faller sammen med deres tidsvindu.

## 4. Advisor-status (lesende)

Eksisterende funn, alle fra før og uten relasjon til de planlagte AI-objektene:
- 15 × RLS aktivert uten policy (INFO)
- 1 × funksjon uten fast `search_path` (WARN)
- 2 × utvidelse i `public` (WARN)
- 16 × SECURITY DEFINER kallbar av `anon` (WARN) — dekket av det dokumenterte unntaket i `docs/sikkerhetsminne.md`
- 76 × SECURITY DEFINER kallbar av innlogget (WARN) — samme dokumenterte unntak

Nye AI-objekter: ingen funn, siden ingen av dem finnes ennå.

## 5. Anbefalt backup-/rollbackmetode

1. Du kjører full dataeksport i Cloud → Advanced settings → Export data rett før migrasjonen.
2. Jeg lagrer i tillegg en skjema-øyeblikksfil (tabeller, kolonner, indekser, funksjoner, triggere, policyer, grants) som referanse for diff etterpå.
3. Migrasjonen kjøres som én `BEGIN … COMMIT`-blokk uten `CONCURRENTLY`, slik at feil ruller alt tilbake automatisk.
4. En eksplisitt rollback-SQL (drop av de 5 tabellene, 9 indeksene, 2 triggerne og tilhørende policyer/grants) skrives før kjøring, men først når du autoriserer det.

## 6. Neste steg (krever din godkjenning)

Ingen av punktene under utføres før du sier fra:
- lage skjema-øyeblikksfil
- skrive rollback-SQL
- stanse de fem navngitte cron-jobbene
- kjøre selve migrasjonen
