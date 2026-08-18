# Årsak til «Kunne ikke behandle forslaget» og opprydding i AI-forslagslisten

## Hva som faktisk skjer (verifisert mot databasen)

Dette er ikke en tilfeldig feil, og det er ikke bare hos deg — det er en
systemfeil som vil ramme alle brukere som kjører analysen etter at trinn 1–4
er gjennomført.

1. **Forslagene peker på funn du allerede har bekreftet.** Av 128 ventende
   forslag peker 126 på parsekandidater som allerede er bekreftet og promotert
   til karriereelementer i trinn 1–4. Databasen har en vakt som stopper
   dobbeltføring («Parsekandidaten er allerede bekreftet som et eget element»),
   så godkjenning avvises. Det er nettopp denne vakten som hindrer duplikater —
   feilen er at listen i det hele tatt viser disse forslagene.
2. **Feilmeldingen skjuler årsaken.** Panelet viser «Kunne ikke behandle
   forslaget» fordi databasefeil ikke er et JavaScript-`Error`-objekt, og
   koden faller derfor tilbake til standardteksten. Den faktiske forklaringen
   forsvinner.
3. **Dobbeltoppførte forslag.** Samme funn (f.eks. BBA-graden) finnes to
   ganger, fra to kjøringer av analysen med ulik pipeline-versjon. Ingen
   dedup på tvers av kjøringer.
4. **Listen blander innholdstyper.** Roller, språk, sertifiseringer,
   utdanning og resultater vises i én udifferensiert liste. Derfor havner
   «Stilling mangler hos Cisco» og lange resultatbeskrivelser side om side
   uten at det er tydelig hva slags element forslaget gjelder.

## Hva som gjøres

### 1. Skjul forslag som allerede er behandlet (kjerneretting)
Forslag som peker på en parsekandidat som allerede er bekreftet, skal ikke
ligge i «Forslag klart for gjennomgang». De markeres som `superseded` med
begrunnelse «allerede bekreftet i gjennomgangen», og listen viser bare det
som faktisk er nytt. Dette skjer både for eksisterende data (engangsopprydding)
og løpende ved henting av listen.

### 2. Dedupliser forslag på tvers av analysekjøringer
Når samme funn foreslås på nytt fra en ny pipeline-versjon, beholdes nyeste
forslag og eldre settes til `superseded`. Ingen dobbeltvisning.

### 3. Ekte feilmeldinger til brukeren
Godkjenningsflyten gir forståelig norsk tekst i stedet for generisk
«Kunne ikke behandle forslaget» — f.eks. «Dette er allerede lagt inn fra
gjennomgangen» eller «Forslaget mangler kobling til en rolle». Databasefeil
mappes til klar tekst.

### 4. Gruppert og lesbar liste
Forslagene grupperes etter type (Roller, Resultater, Kompetanse,
Kvalifikasjoner: utdanning/språk/sertifisering) med tydelig etikett per kort,
kort tittel og selskap/rolle-kontekst i stedet for full CV-setning som
overskrift. Lange beskrivelser vises som brødtekst, ikke som tittel.

### 5. Blokkér ugyldige godkjenninger før de sendes
Forslag som ikke kan bli et gyldig element (manglende rolletilknytning,
manglende belegg for kompetanse) får deaktivert «Godkjenn» med forklaring og
en lenke til riktig trinn, i stedet for å feile etter klikk.

## Teknisk

- `src/lib/queries/atom-enrichment.ts`: filtrer bort forslag med
  `structured_data.parse_candidate_id` som allerede er promotert; oversett
  Postgrest/plpgsql-feil (inkl. trigger-meldingene fra
  `career_atom_sync_parse_candidate`) til brukervendt norsk; dedupliser på
  `structured_data.source_hash` + `atom_type` og behold nyeste.
- Migrasjon: engangs `UPDATE atom_enrichment_proposals SET status='superseded'`
  for ventende forslag som peker på bekreftede kandidater eller er duplikater;
  indeks på `(user_id, status)` beholdes.
- `src/components/cv/CvAnalysisPanel.tsx`: gruppering per atomtype, korrekt
  tittel/undertekst, deaktivert godkjenn-knapp med begrunnelse, feilvisning
  med reell årsak.
- Ingen endring i evidensmodellen; vakten mot dobbeltføring beholdes.
