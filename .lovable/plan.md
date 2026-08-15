# Etter nullmålingen: oppfølging av registerspeilet

Prosjekt: `miwzhbludgwvskmsfqnq`. Nullmålingen er godkjent. Denne planen er revidert etter beslutningene om fullnedlasting, varslingsprioritet og rekkefølge. Ingenting er endret i koden ennå — hvert punkt kjøres som egen godkjent oppgave, med måling før og etter mot tallene i nullmålingen.

## 1. Enhetsspeil med fullnedlasting hver 14. dag

Inkrementell synk mot oppdateringsstrømmen bygges **ikke**. Beslutningen er tatt: enhetsspeilet oppdateres med fullnedlasting fra Brreg hver 14. dag. Ingen markør, ingen cap-håndtering, ingen opprydding av kjøringer som ikke fullfører. 14 dagers ferskhet er tilstrekkelig for arbeidsgiveranalyse.

Rammer som gjelder uansett detaljinstruks:
- **Upsert-only.** Ingen `DELETE`, ingen `TRUNCATE`. Rader som forsvinner fra Brreg-filen skal spores, ikke fjernes.
- **Sporing av manglende rader.** Enheter som finnes lokalt men ikke i siste fil registreres som fravær med tidspunkt, slik at sletting kan besluttes senere som egen sak.
- **Kjøringslogg.** Hver kjøring skriver rad i `reg.sync_log` med `status` = ok/partial/failed, etter samme mønster som `regnskap_sync_runs`, som fungerer i dag.
- **Porter.** Kjøringen avbrytes før skriving hvis filen avviker unormalt i størrelse eller radantall mot forrige kjøring.

Utgangspunkt: 439 773 rader lokalt, ferskeste `oppdatert_tidspunkt` 15. juni 2026, ca. 380 700 Brreg-oppdateringer siden da. Detaljinstruks kommer separat.

## 2. Varsling om uteblitt eller feilet kjøring

Flyttet opp fordi punkt 1 avhenger av den. Med to ukers intervall tar en jobb som stopper svært lang tid å oppdage.

I dag varsler ingen kode ved feilet eller uteblitt synk. E-postinfrastrukturen (`enqueue_email`, `email_send_log`) brukes kun til brukerkommunikasjon og selskapsanalyse-leads.

Tiltak: en daglig vaktjobb som varsler når en kilde mangler vellykket kjøring innen sitt forventede vindu. Vinduer per kilde: enheter 14 dager + margin, regnskap kvartersvis, NAV 30 min, Careerjet 6 timer.

## 3. Totalantall og LIMIT 300

Ren funksjonell feil, ikke ytelse. To ting:
- `search_employers` returnerer ikke `total_count`. Frontend leser `arr[0].total_count`, får `undefined`, setter `totalCount = null`. Brukeren ser aldri treffantall.
- Kandidat-CTE-en kapper på `LIMIT 300`. Ved 11 603 treff på «bygg» når brukeren maksimalt tolv sider. Det meste av resultatene er utilgjengelige.

Tiltak: eksakt antall under en terskel, estimat over, og paginering som faktisk når hele treffmengden.

## 4. Søkeytelse

Samme problem som Suverra hadde, og Suverras løsning brukes som utgangspunkt i stedet for å utledes på nytt: normalisert kolonne, hevet likhetsterskel, rangert flernivåsøk med btree for eksakt treff og prefiks, FTS og trigram som fallback. Suverra gikk fra 5 602 ms til under 1 ms.

Målt utgangspunkt her: «consulting» 3 717 ms, «bygg» 3 456 ms, «e» 1 119 ms, med ~200 000 rader forkastet i filter. Årsaken er at `ORDER BY similarity(...)` ikke kan betjenes av GIN-trigram, så planleggeren faller til parallell seq scan på brede ord.

## 5. Ansatte-visning med ukjent som egen kategori

283 048 av 439 773 enheter (64 %) har `har_registrert_antall_ansatte = false`. Visningen skiller ikke ukjent fra null. Andelen er lavere enn Suverras 85 % fordi arbeidsgiverfilteret fjernet mange av de minste, men høy nok til at punktet er reelt.

Tiltak: «ukjent» som egen, synlig kategori i tabell og innsiktspanel.

## 6. NAV-datakvalitet: logg hvilket felt som mangler

`missing required field` utløses når `external_id`, `title` eller `company_name` mangler, men loggen sier ikke hvilket. Tiltak: logg feltnavnet.

## 7. Toaster-gjennomgang

`<Toaster />` er montert. Gjennomgang av feil som fanges i `catch` uten å nå brukeren, med `src/lib/queries/atom-enrichment.ts` og `src/lib/queries/cv-imports.ts` som første kandidater — begge berører CV-modulen der ontologiarbeidet kommer.

## Kosmetisk

Døp om `regnskap-sync-nightly`, som kjører `13,28,43,58 * * * *` — fire ganger i timen. Samme navnefeil som hos Suverra, der den bidro til to gigabyte kjøringslogg uten at noen la merke til det.

## Ikke funnet her — ingen tiltak

- Avledede markører er korrekte: `er_utdanning` 93, `er_rekruttering` 2 361, `er_offentlig` 4 205 — alle stemmer med forventet.
- Kjøringsloggen er ryddig: `cron.job_run_details` 1,4 MB / 933 rader, `rydd-cron-logg` kjører daglig.
- Én-strategi-søket som skjulte treff finnes ikke: «telenor» gir 41 treff.
