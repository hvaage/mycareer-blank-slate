# LinkedIn-import: bakgrunnskjøring, varsling, attesteringer og fullstendig kontaktregister

## Status på det du spurte om (bekreftet i kode og data)

- **Importen kjører i dag i forgrunnen.** Opplastingen leser, validerer, stager og avstemmer hele arkivet i én forespørsel før svaret sendes. Med ~4000 kontakter betyr det lang venting og risiko for tidsavbrudd. Det finnes allerede en intern bakgrunnsrute for arbeidet, men opplastingen bruker den ikke.
- **Læring og Innhold er valgbart** ved import («Læring» og «Innhold»), og lagringen for begge finnes. Du huket dem ikke av denne gangen, så filene ble funnet, men aldri lest. De blir lagret når du huker dem av — men feltkartleggingen for kurs er svak (kurs-URL hentes fra beskrivelsesfeltet, fullført-dato fra «sist sett»), så den må rettes for å bli riktig.
- **Attesteringer (endorsements) lagres i dag feil.** Filene leses, men de havner i anbefalingslageret der kompetansenavnet presses inn i et «tittel»-felt sammen med selskap og stilling. Det finnes ingen kobling mellom kompetanse og antall som har støttet den.
- **Kontaktregisteret er for tynt.** Mellomlageret har navn, selskap, stilling, tilkoblingsdato og profil-URL, men det ferdige kontaktregisteret har ikke felt for stilling eller profil-URL, så stillingen faller bort ved overføring.

## Det som skal gjøres

### 1. Importen kjøres i bakgrunnen med varsling
- Opplastingen registrerer importen, kvitterer umiddelbart og starter arbeidet i bakgrunnen. Brukeren kan lukke siden, navigere videre eller logge ut.
- Fremdrift vises på importkortet (validering → innlesing → avstemming) med hjerteslag, slik at en stanset kjøring oppdages og kan startes på nytt.
- Når importen er ferdig — eller feiler — varsles brukeren:
  - i appen, som en varsling i toppen med lenke til kildegjennomgangen,
  - og på e-post med kort oppsummering (antall funn per område, eller feilårsak).
- Feilmelding er alltid handlingsrettet: hva som gikk galt og hva brukeren kan gjøre.

### 2. Attesteringer lagres som støtte per kompetanse
- Attesteringer skilles ut fra anbefalinger og lagres for seg, med kompetansenavn, hvem som støttet, og dato.
- Per kompetanse beregnes antall som har gitt støtte, og tallet vises i kompetanseoversikten («Støttet av 14 på LinkedIn»).
- Støtte fra andre er aldri belegg for din egen påstand. Den vises som ekstern indikasjon, tydelig atskilt fra ditt eget belegg, i tråd med evidensprinsippet.
- Attesteringer du har gitt til andre lagres, men vises ikke i din kompetanseprofil.

### 3. Kontaktregisteret utvides
- Kontakter lagres med navn, stilling, selskap, tilkoblingsdato, profil-URL og siste oppdatering fra eksporten.
- Ved ny import oppdateres eksisterende kontakter (endret stilling eller selskap) i stedet for å dupliseres, og endringen kan vises som historikk.
- Selve nettverksimporten forblir en masseoperasjon uten enkeltbeslutninger — 4000 kontakter skal aldri bli 4000 forslag; brukeren tar én beslutning for hele nettverket.

### 4. Læring og Innhold verifiseres
- Feltkartleggingen for kurs rettes: kurstittel, tilbyder, faktisk fullført-dato og kurslenke fra riktige kolonner.
- Kurs avstemmes mot kvalifikasjonene dine på samme måte som sertifiseringer.
- Innhold (artikler og innlegg) lagres og vises som kontekst du kan bruke som dokumentasjon, ikke som påstander om kompetanse.
- Begge deler dekkes av tester slik at avhuking faktisk gir lagrede rader.

### 5. Fortsatt gjeldende fra forrige plan
- Karriereavstemmingen rettes (bolkevis henting) og kjøres på nytt, slik at stillinger, kompetanse, sertifiseringer, utdanning, språk og frivillig arbeid faktisk blir forslag.
- Stillinger vises kompakt som i CV-importens Trinn 1 og avstemmes mot rollene i «Erfaring og kompetanse».
- Jobbsignaler importeres ikke; virkningsløse forslag opprettes aldri.
- Klikk gir umiddelbar respons, angremulighet og «Behandlet»-seksjon; «Sikkerhet 50 %» erstattes med forklarende tekst.
- Norsk er løsningens språk.

## Teknisk gjennomføring

- Opplastingsruten svarer etter registrering og delegerer validering, staging og avstemming til den eksisterende interne arbeidsruten, kalt uten at klienten venter. Arkivet mellomlagres slik at arbeideren kan lese det uavhengig av forespørselen.
- Status, fase, hjerteslag og tellere finnes allerede på importraden og brukes til fremdriftsvisning og gjenoppretting av avbrutte kjøringer.
- Varsling: en varslingsrad per fullført/feilet import som frontend leser, pluss e-post via eksisterende utsendingskø.
- Ny lagring for attesteringer (kompetansenavn, retning, motpart, dato) med aggregert støttetelling per kompetanse; kildesporing som ellers.
- Kontaktregisteret utvides med stilling, profil-URL og oppdateringstidspunkt, med oppdatering på nøkkel i stedet for duplisering.
- Kartleggingen for kurs rettes i feltmappingen; avstemming for læring og innhold får tester.

## Rekkefølge

1. Bakgrunnskjøring med fremdrift og varsling (ellers er ikke store arkiv brukbare).
2. Rett karriereavstemmingen og kjør den på nytt.
3. Attesteringer med støttetelling per kompetanse.
4. Utvidet kontaktregister.
5. Kurs og innhold: rettet kartlegging og verifisering.
6. Øvrige punkter fra forrige plan.
