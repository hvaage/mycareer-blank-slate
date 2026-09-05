# Overføringsbrief — rett feilet NAV-oppdatering i ESCO

Kopier teksten under inn i **Hvaage/ESCO**, som eier GitHub Actions-jobben «Import NAV monthly market stats».

## Oppdrag

Finn den dokumenterte rotårsaken til at workflowen **«Import NAV monthly market stats»** feilet på `main`, rett feilen i eksisterende importløype, kjør importen kontrollert og kontroller at riktig NAV-periode er publisert uten tap eller duplikater.

Varslet viser referanse `ed28d90` og «All jobs have failed». Karrierenmin.no og «Jobbkompetanse Explorer» skal ikke endres for å maskere feilen; de er kun konsumenter av ESCO-markedsdata.

## 1. Diagnostiser før du endrer

1. Finn workflowfilen med visningsnavn «Import NAV monthly market stats» og kjøringen som svarer til `ed28d90`.
2. Les komplett logg for alle feilede steg. Finn den **første reelle feilen**, ikke bare avsluttende exit code.
3. Rapporter jobb, steg, kommando, stack trace/HTTP-/databasefeil og om feilen oppstod ved uthenting, parsing, transformasjon eller skriving.
4. Sammenlign med siste vellykkede kjøring: kode, avhengigheter, runtime, inputformat og periode.
5. Ikke gjør en spekulativ endring. Hvis den konkrete loggen ikke kan hentes, avslutt `BLOCKED` med nøyaktig manglende tilgang eller logg.

## 2. Kontroller datatilstanden før retting

Kontroller uten å mutere data:

- NAV-kilde og periode jobben forsøkte å importere
- sist fullførte periode
- om den feilede kjøringen skrev alt, deler eller ingenting
- radantall per berørt datasett
- delvise eller dupliserte rader på naturlig nøkkel/kildeidentitet
- importstatus og siste sikre cursor/checkpoint, dersom det finnes
- om offentlige markeds-RPC-er fortsatt leverer forrige komplette datasett

Ikke slett eller nullstill tidligere gyldige markedsdata.

## 3. Rett kun bekreftet feilklasse

Undersøk relevante kontrollpunkter, men konkluder bare ut fra loggbevis:

- **NAV-kilde:** URL, redirect, statuskode, autentisering, rate limit eller timeout.
- **Format:** encoding/BOM, skilletegn, kolonnenavn, dato-/tallformat eller obligatoriske felt.
- **Database:** skjema/type, constraint, timeout/lås, grant/RLS eller RPC-signatur.
- **Kapasitet:** CPU/minne/tid, for store batcher eller rad-for-rad-skriving.
- **Workflow:** action/runtime/avhengighet, working directory, filsti eller installsteg.

Krav til rettingen:

- Gjenbruk eksisterende importløype; ikke bygg en parallell pipeline.
- Retry skal være idempotent og ikke lage duplikater.
- Ved kapasitetsfeil: bruk avgrensede batcher og lagret resume-state; flytt checkpoint først når hele batchen er skrevet.
- Ved formatfeil: valider obligatoriske felt og gi trygg diagnostikk uten å logge sensitivt råinnhold.
- Ved transiente nettverksfeil: kontrollert retry/backoff. Kontrakt- og autentiseringsfeil skal feile tydelig.
- Ved migrasjon: bruk additive, produksjonssikre endringer uten destruktiv omskriving.
- `SECURITY DEFINER` skal ha fast `search_path`; ikke gi PUBLIC-tilgang uten dokumentert behov.
- Bevar forrige komplette datasett dersom ny import feiler.
- Ikke be om, vis, kopier eller logg secret-verdier.

## 4. Sikre samme feilklasse

Legg bare til vern som følger av rotårsaken:

- preflight av kilde, skjema og nødvendige konfigurasjonsnavn
- fasebaserte feilmeldinger og tellinger
- idempotent upsert/deduplisering
- staging/transaksjonsgrense som hindrer halvferdig publisering
- resume-state ved kapasitetsproblem
- run-status `started`, `completed` eller `failed`, med siste sikre checkpoint

## 5. Tester

Gjenskap den faktiske feilen i en målrettet test som feiler før og passerer etter rettingen. Test også:

1. normal gyldig NAV-respons/fil
2. retry av samme periode uten duplikater
3. delvis batch etterfulgt av resume
4. manglende obligatorisk felt publiserer ikke et halvferdig datasett
5. relevante offentlige markeds-RPC-er svarer etter fullført import

Ikke bruk bare mocks dersom feilen lå i ekstern kontrakt eller databaseoperasjon.

## 6. Kontrollert ny kjøring

1. Kjør canary/dry-run hvis importøren støtter det.
2. Kjør deretter reparert workflow manuelt for samme relevante periode.
3. Hvis gammel run ikke kan kjøres på ny kode, bruk en ny manuell kjøring med samme inngangsperiode.
4. Ikke opprett en ekstra schedule; behold én autoritativ månedlig workflow.
5. Overvåk til faktisk avslutning.

## 7. Akseptanse

Rapporter forventet og observert resultat for:

- workflow, jobb og alle steg er grønne
- import-run er `completed`, ikke bare startet
- korrekt kildeperiode og importtid
- hentet, lest, avvist, skrevet, oppdatert og uendret antall
- ingen duplikater på naturlig nøkkel/kildeidentitet
- ingen utilsiktet reduksjon i tidligere gyldige perioder
- siste komplette periode er tilgjengelig gjennom relevante offentlige markeds-RPC-er
- minst ett realistisk yrkesoppslag returnerer NAV-markedstall med korrekt periode og kilde
- ingen secrets eller nøkkelverdier i logger eller klientrespons
- neste månedlige schedule er aktiv, uten parallell schedule

Exit code 0 er ikke tilstrekkelig dersom loggen inneholder feil, status ikke er fullført eller tellingene ikke stemmer.

## 8. Stoppbare avvik

Avslutt `BLOCKED` før muterende kjøring dersom:

- den konkrete feilloggen ikke kan hentes
- nødvendig secret mangler ved runtime
- NAV-kontrakten ikke kan bekreftes
- rettingen krever destruktiv sletting/overskriving av gyldige perioder
- riktig produksjonsdatabase eller workflow ikke kan identifiseres
- en uforklart delvis import kan forverres ved retry

Oppgi bare navnet på manglende konfigurasjon, aldri verdien.

## 9. Sluttrapport

Svar kort og etterprøvbart:

1. **Rotårsak:** første reelle feil med workflow-, jobb- og stegnavn.
2. **Endret:** filer, migrasjoner, funksjoner og workflow-steg.
3. **Verifisert:** tester og ny produksjonskjøring, med run-referanse.
4. **Datakontroll:** periode og eksakte tellinger før/etter.
5. **Drift:** neste månedlige kjøring og resterende risiko.
6. Avslutt `GO` bare når workflow og datakontroller består; ellers `BLOCKED` med konkrete mangler.

## Allerede avklart

- Karrierenmin.no har bare en separat leseklient mot ESCO-data.
- «Jobbkompetanse Explorer» har visning og RPC-kall, men ingen NAV-importjobb.
- Rotårsaken kan ikke fastslås fra e-postskjermbildet alene; steglokken fra **Hvaage/ESCO** er nødvendig.
