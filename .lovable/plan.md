# Etter nullmålingen: hva som bør rettes i registerspeilet

Prosjekt: `miwzhbludgwvskmsfqnq`. Nullmålingen er utført og rapportert i chat. Denne planen er kun forslag til oppfølging — ingenting er endret.

## Rangert etter alvorlighet

### 1. Enhetsspeilet synkroniseres ikke i det hele tatt (kritisk)
`reg.sync_log` er tom (0 rader), det finnes ingen kolonne som lagrer Brregs `oppdateringsid` noe sted i `reg`, og ingen cron-jobb dekker enhetsregisteret. Ferskeste `oppdatert_tidspunkt` i `reg.enheter` er 15. juni 2026. Brreg har hatt ca. 380 700 oppdateringer siden da.

Tiltak: bygg en enhetssynk med varig markør (`oppdateringsid`) og kjøringslogg i `reg.sync_log`, etter samme mønster som `regnskap_sync_runs` (som fungerer og logger hvert kvarter). Skriv `status` = ok/partial/failed slik oppgave A etablerte.

### 2. Søk faller til full tabellskanning på vanlige ord (høy)
Brede søkeord planlegges som parallell seq scan over hele `reg.enheter` fordi `ORDER BY similarity(...)` ikke kan betjenes av GIN-trigram: «bygg» 3 456 ms, «consulting» 3 717 ms, «e» 1 119 ms, med ~200 000 rader forkastet i filter.

Tiltak (som egen, godkjent oppgave): to-trinns strategi — hent kandidater via trigram/prefiks-indeks først, sorter etterpå på det begrensede settet. Eventuelt en `navn`-normalisert kolonne med `gin_trgm_ops` + `word_similarity`-terskel.

### 3. Totalantall vises aldri (høy, funksjonell)
`search_employers` returnerer ikke `total_count`; frontend leser `arr[0].total_count`, får `undefined`, og setter `totalCount = null`. I tillegg kapper kandidat-CTE-en på `LIMIT 300`, så maks 12 sider er tilgjengelig selv når det finnes 11 603 treff.

Tiltak: returner et eksakt antall under en terskel og et estimat over, og vis at listen er avkortet.

### 4. «Ansatte» kan tolkes som selskaper med ansatte (middels)
283 048 av 439 773 enheter (64 %) har ukjent ansattall. Visningen skiller ikke ukjent fra null. Tiltak: vis «ukjent» eksplisitt i tabell og innsiktspanel.

### 5. Datakvalitetsavvik fra NAV-kilden (lav, men skal følges)
`missing required field` betyr manglende `title` eller `company_name` i NAV-annonsen. Tiltak: logg hvilket felt som mangler, ikke bare at noe mangler.

### 6. Ingen driftsvarsling (middels)
Ingen kode varsler ved feilet eller uteblitt synk. E-postinfrastrukturen brukes kun til brukerkommunikasjon (leads/selskapsanalyse). Tiltak: en daglig vaktjobb som varsler når en kilde ikke har hatt vellykket kjøring innen forventet vindu.

### 7. Toaster-klassen: flere steder uten visning
`<Toaster />` er nå montert. Neste steg er en gjennomgang av feil som fanges i `catch` uten å nå brukeren, med `src/lib/queries/atom-enrichment.ts` og `src/lib/queries/cv-imports.ts` som første kandidater.

## Ikke funnet her
- Avledede markører er korrekte: `er_utdanning` = 93 = antall 85.4, `er_rekruttering` = 2 361 = antall 78.x, `er_offentlig` = 4 205 = forventet 4 205.
- Kjøringsloggen er ryddig: `cron.job_run_details` er 1,4 MB / 933 rader, jobben `rydd-cron-logg` kjører daglig.
- Jobbnavn stemmer ikke helt med skjema: `regnskap-sync-nightly` kjører fire ganger i timen — kosmetisk, men verdt å endre navn.

## Rekkefølge
1 → 3 → 2 → 6 → 4 → 5 → 7. Hvert punkt som egen godkjent oppgave, med måling før og etter mot tallene i nullmålingen.
