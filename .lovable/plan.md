# Kildegjennomgang: rask beslutning, språkvalg og tydelig sikkerhetsgrad

## Hva jeg fant (bekreftet mot data og kode)

- Klikkene registreres faktisk. Databasen viser at både «Avvis» og «Behold det jeg har» har blitt lagret (3 profilforslag og 1 jobbforslag står som avvist). Problemet er at siden ikke gir noe synlig svar: det kommer ingen bekreftelse, kortet blir liggende på samme plass i listen, og hele listen på 305 forslag hentes på nytt før den lille statusmerkelappen endrer seg. For brukeren ser det ut som ingenting skjedde.
- 299 av 305 forslag er «Jobbsignaler» — lagrede/søkte stillinger fra LinkedIn. De er markert som ren kontekst og kan ikke overføres til karriereoversikten i det hele tatt. De burde altså aldri ha vært 299 enkeltbeslutninger.
- Reelle beslutninger er 6: 4 profilfelter (navn, sted, sammendrag, tittelrad) og 2 nye elementer.
- Språkkonflikten er reell: LinkedIn-profilen er skrevet på engelsk, profilen i systemet på norsk. Sammendrag og tittelrad blir derfor rapportert som «motstrid» selv om innholdet i praksis er samme person beskrevet på to språk. Profilen har i dag ikke noe felt for hvilket språk innholdet skal være på.
- «Sikkerhet 50 %» er avstemmingens interne tillit til at forslaget er riktig koblet. Den vises som et nakent tall uten forklaring, og for kontekstforslagene er verdien fast (20 %) og helt uten mening for brukeren.

## Det jeg foreslår

### 1. Klikk skal svare umiddelbart
- Beslutningen oppdaterer kortet med én gang (optimistisk), uten å vente på ny henting av hele listen.
- Kort som er ferdig behandlet forsvinner ut av arbeidslisten og legges i en sammenleggbar seksjon «Behandlet (n)» med «Angre».
- Kort bekreftelse nederst: «Avvist — Angre».
- Knappene låses bare på det kortet man trykker på, ikke på hele listen.

### 2. Komprimert gjennomgang i stedet for 300 kort
- **Jobbsignaler skilles ut av beslutningskøen.** De er kontekst, ikke forslag. De vises som én sammenslått rad: «299 lagrede og søkte stillinger fra LinkedIn — vises som kontekst, endrer ingenting». Kan åpnes som en tabell (tittel, selskap, dato, lenke) og skjules med ett klikk for hele gruppen. Telleren øverst teller da 6 reelle beslutninger, ikke 305.
- **Ny standardvisning: kompakt liste.** Én linje per forslag — type, kort tittel, «fra LinkedIn → det du har» på samme rad — med fire ikonknapper (godkjenn / behold / utsett / avvis). Full sammenligning åpnes ved å utvide raden. Detaljkortene beholdes for motstrid.
- **Avkryssing og massehandling.** Velg flere (eller «velg alle i gruppen») og avvis/godkjenn/utsett i én operasjon, med én angremulighet.
- **Gruppering med gruppevedtak.** Forslag samles per type (f.eks. «Kurs», «Nettverk», «Jobbsignaler») med «Avvis hele gruppen» / «Godkjenn hele gruppen» der det er forsvarlig. Motstrid kan aldri gruppegodkjennes.
- **Fokusmodus (valgfritt).** «Gå gjennom én og én» viser ett forslag om gangen med tastatursnarveier (G = godkjenn, A = avvis, U = utsett) og fremdrift «3 av 6».
- Sidevisning/lat innlasting slik at store grupper ikke rendres på én gang.

### 3. Språk (norsk/engelsk)
- Nytt valg i profilen: **innholdsspråk for profiltekst** — norsk (standard) eller engelsk.
- Avstemmingen bruker valget: når LinkedIn-teksten er på et annet språk enn valgt innholdsspråk, merkes forslaget «Ulikt språk» i stedet for «Motstrid», og brukeren får tre tydelige valg:
  - behold min norske tekst,
  - bruk LinkedIn-teksten som den er,
  - lagre LinkedIn-teksten som engelsk versjon av feltet (påvirker ikke den norske).
- Første gang et språkavvik oppdages, vises en engangsavklaring øverst: «LinkedIn-profilen din er på engelsk, profilen her er på norsk. Hvilket språk skal gjelde?» Svaret lagres og gjenbrukes.
- All brukervendt tekst i selve grensesnittet forblir norsk uansett valg.

### 4. «Sikkerhet» erstattes med forståelig tekst
- Tallet fjernes fra kortene. I stedet vises grunnlaget for koblingen i klartekst, f.eks.:
  - «Sikker kobling — samme felt i profilen din»
  - «Trolig samme — navn og selskap stemmer»
  - «Usikker kobling — sjekk selv før du godkjenner»
  - Kontekstrader viser ingen sikkerhetsangivelse i det hele tatt.
- Prosenten beholdes bare som detalj bak «Hvorfor dette forslaget?» sammen med hvilken metode som ble brukt.

## Teknisk gjennomføring

- `src/routes/_authenticated/kildegjennomgang.tsx` deles opp: liste-/gruppekomponent, kompakt rad, detaljkort, kontekstgruppe, fokusmodus.
- Beslutningsmutasjonen får optimistisk oppdatering av cachen (`onMutate`/`onError`-rollback) og målrettet invalidering, i stedet for å hente alle rader på nytt ved hvert klikk. Angre = ny beslutning via samme lagringspunkt (beslutningshistorikken er allerede versjonert i basen, så ingenting overskrives).
- Massehandling kjøres som sekvensielle kall mot eksisterende beslutningsfunksjon med samlet fremdrift og én oppsummerende bekreftelse; ingen ny databasefunksjon er nødvendig for dette.
- Kontekstforslag (kind = kun kontekst) filtreres ut av beslutningstelleren i grensesnittet og telles separat.
- Språkvalget krever ett nytt felt på profilen (innholdsspråk) med migrasjon og tilhørende tilgangsregler, samt et valg i profilinnstillingene. Avstemmingen som lager profilforslag utvides med en enkel språkdeteksjon slik at ulikt språk kodes som eget avviksgrunnlag.
- «Sikkerhet»-tallet mappes til tekst i frontend ut fra koblingsmetode og verdi; ingen dataendring nødvendig.

## Rekkefølge

1. Umiddelbar respons på klikk + angre + behandlet-seksjon (løser «ingenting skjer»).
2. Jobbsignaler ut av beslutningskøen + kompakt liste + massehandling (løser 300-problemet).
3. «Sikkerhet» erstattes med klartekst.
4. Språkvalg i profilen og språkbevisst behandling av profilfelt.
