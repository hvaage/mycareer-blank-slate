# Kildegjennomgang: rask beslutning, ingen støyforslag, norsk som språk

## Hva jeg fant (bekreftet mot data og kode)

- Klikkene registreres faktisk. Databasen viser at både «Avvis» og «Behold det jeg har» har blitt lagret (3 profilforslag og 1 jobbforslag står som avvist). Problemet er at siden ikke gir noe synlig svar: det kommer ingen bekreftelse, kortet blir liggende på samme plass, og hele listen på 305 forslag hentes på nytt før statusmerkelappen endrer seg. For brukeren ser det ut som ingenting skjedde.
- 299 av 305 forslag er «Jobbsignaler» — historisk jobbsøk-aktivitet fra LinkedIn. De kan ikke overføres til karriereoversikten i det hele tatt og har ingen verdi i denne løsningen.
- Reelle beslutninger er 6: 4 profilfelter (navn, sted, sammendrag, tittelrad) og 2 nye elementer.
- Profilteksten fra LinkedIn er engelsk, profilen her er norsk. Det gir «motstrid» på sammendrag og tittelrad.
- «Sikkerhet 50 %» er avstemmingens interne tillit til koblingen. Den vises som et nakent tall uten forklaring.

## Det jeg foreslår

### 1. Jobbsignaler importeres ikke i det hele tatt
- LinkedIn sin historikk over søkte og lagrede stillinger er ikke data vi skal føre videre. Systemet skal holde oversikt over søknader brukeren gjør *her*, ikke i LinkedIn.
- Avstemmingen slutter å lage forslag fra denne kategorien, og importen slutter å behandle den som en kilde til forslag. Filene kan fortsatt ligge i eksporten uten å gi utslag.
- De 299 eksisterende radene fjernes fra brukerens kø, slik at telleren viser de 6 reelle beslutningene.

### 2. Forslag som ikke endrer noe skal aldri vises
- Alt som ender i «Dette forslaget endrer ingenting … du kan avvise det for å skjule det» er støy. Slike forslag opprettes ikke lenger, og eksisterende rader av denne typen tas ut av gjennomgangen.
- Regelen blir generell: hvis et forslag ikke kan føre til en endring i karriereoversikten eller profilen, er det ikke et forslag og skal ikke havne i køen.
- Der noe faktisk er identisk (f.eks. navn som allerede stemmer), avsluttes det automatisk uten at brukeren må klikke.

### 3. Klikk skal svare umiddelbart
- Beslutningen oppdaterer kortet med én gang, uten å vente på ny henting av hele listen.
- Behandlede kort forsvinner fra arbeidslisten og legges i en sammenleggbar seksjon «Behandlet (n)» med «Angre».
- Kort bekreftelse: «Avvist — Angre».
- Knappene låses bare på kortet man trykker på.

### 4. Komprimert gjennomgang
- **Kompakt liste som standard:** én linje per forslag — type, kort tittel, «fra LinkedIn → det du har» — med ikonknapper (godkjenn / behold / utsett / avvis). Full sammenligning ved å utvide raden. Detaljkort beholdes for motstrid.
- **Avkryssing og massehandling:** velg flere (eller «velg alle i gruppen») og avvis/godkjenn/utsett i én operasjon, med én angremulighet.
- **Gruppering per type** med gruppevedtak der det er forsvarlig. Motstrid kan aldri gruppegodkjennes.
- **Fokusmodus (valgfritt):** ett forslag om gangen med tastatursnarveier (G/A/U) og fremdrift «3 av 6».
- Sidevisning slik at store grupper aldri rendres samlet.

### 5. Språk: norsk er løsningens språk
- Hele løsningen og alt profilinnhold holdes på norsk. Ingen nytt språkvalg i profilen.
- Når LinkedIn-teksten er engelsk og profilteksten norsk, behandles det som en vanlig motstrid der norsk tekst er standardvalget, og det vises tydelig at kildeteksten er på engelsk.
- Engelske søknader og CV-er håndteres som en egen ting senere: teksten oversettes og genereres på engelsk kun når brukeren eksplisitt ber om det ved generering. Det påvirker ikke hva som lagres i profilen.

### 6. «Sikkerhet» erstattes med forståelig tekst
- Tallet fjernes fra kortene. I stedet vises grunnlaget i klartekst:
  - «Sikker kobling — samme felt i profilen din»
  - «Trolig samme — navn og selskap stemmer»
  - «Usikker kobling — sjekk selv før du godkjenner»
- Prosenten beholdes bare som detalj bak «Hvorfor dette forslaget?».

## Teknisk gjennomføring

- Avstemmingslaget som lager LinkedIn-forslag slutter å produsere jobbsøk-forslag og forslag uten mulig effekt; regelen håndheves ett sted, ikke i visningen.
- Opprydding av eksisterende rader for berørte brukere gjøres som en datajobb (setter dem ut av kø, ingen historikk overskrives).
- `src/routes/_authenticated/kildegjennomgang.tsx` deles opp: liste-/gruppekomponent, kompakt rad, detaljkort, fokusmodus.
- Beslutningsmutasjonen får optimistisk cache-oppdatering med tilbakerulling ved feil og målrettet invalidering i stedet for full refetch. Angre = ny beslutning via samme lagringspunkt.
- Massehandling kjøres som sekvensielle kall mot eksisterende beslutningsfunksjon med samlet fremdrift og én oppsummering; ingen ny databasefunksjon nødvendig.
- «Sikkerhet»-tallet mappes til tekst i frontend; ingen dataendring.
- Ingen skjemaendring for språk.

## Rekkefølge

1. Stopp jobbsignaler og virkningsløse forslag ved kilden, og rydd eksisterende kø.
2. Umiddelbar respons på klikk + angre + behandlet-seksjon.
3. Kompakt liste, massehandling, fokusmodus.
4. «Sikkerhet» erstattes med klartekst.
