# Fase 5G — Selskapsinnsikt og skalerbar kildegjennomgang

To leveranser: reell arbeidsgiverinnsikt og registernøkkeltall på selskapsdetaljen i Nettverksarbeid, og en kildegjennomgang som tåler mange forslag uten feilrouting eller duplikater.

## A. Arbeidsgiverinnsikt og dimensjoner

Kartlegging av faktisk modell (bekreftet ved spørring mot analysegrunnlaget): analysen har **åtte** dimensjoner med faste nøkler og norske navn:

Kultur og verdier, Ledelseskvalitet, Arbeidsmiljø, Karriereutvikling, Finansiell stabilitet, Misjon og formål, Mangfold og inkludering, Rekruttering og retensjon.

Hver dimensjon har score, begrunnelse, «hva det betyr», bevisstatus og kilde-ID-er. I tillegg finnes samlet vurdering, KI-modenhet, sammendrag, funn, kilder og proveniens for både research og register. Sju selskaper har en slik analyse i dag.

Slik vises det:

- Alle åtte områdene listes med samme navn som i datagrunnlaget. Områder uten score for det aktuelle selskapet merkes «Ikke analysert» — aldri en oppdiktet verdi.
- Er det flere analyser eller kjøringer for samme selskap, velges den seneste fullførte og vellykkede deterministisk (nyeste analysetidspunkt; ved likhet nyeste kjøring). Valget er stabilt mellom lastinger.
- Panelet viser analysetidspunkt, kildetype og antall brukervurderinger bak aggregatet.
- KI-score og aggregert brukerscore står i to visuelt og semantisk adskilte grupper, med tydelig merking av KI-generert innhold. De blandes aldri i samme tall.
- Selskaper uten analyse beholder tomtilstanden med kort forklaring.

## B. Registernøkkeltall

Kartlegging: applikasjonen har allerede en lovlig kobling til arbeidsgiver- og regnskapsregister. Frontend leser aldri registertabellene direkte, men går via den etablerte RPC-en for arbeidsgiverdetalj, nøklet på organisasjonsnummer. Grunnlaget inneholder blant annet regnskapsår, regnskapstype og periode, driftsinntekter, driftsresultat, årsresultat, sum eiendeler, egenkapital og gjeld, valuta og hentetidspunkt, i tillegg til organisasjonsform, næringskode, antall ansatte og status som konkurs eller under avvikling.

Slik vises det:

- Kompakt panel «Registerdata og nøkkeltall» på selskapsdetaljen når selskapet har organisasjonsnummer: nyeste regnskapsår, driftsinntekter, driftsresultat, årsresultat, sum eiendeler, egenkapital og gjeld — kun feltene som faktisk finnes, alltid med kilde og hentetidspunkt.
- Eksisterende nøkkeltall-visning fra arbeidsgiverflaten gjenbrukes, ikke reimplementeres.
- Mangler organisasjonsnummer eller regnskapsdata: panelet viser «Regnskapstall er ikke tilgjengelig ennå» med kort forklaring. Aldri nullverdier, og aldri KI-score som erstatning for nøkkeltall.
- Selskaper som bare er kjent via navn fra kontakter får uendret adferd: ingen registerdata, ingen status eller prioritet.

## C. Massegjennomgang i kildegjennomgangen

I dag ligger 115 forslag til gjennomgang for brukeren, hvorav 94 er kompetanser. Ett kort med dialog per forslag er ikke brukbart i den skalaen.

Layout og valg:

- Handlingsbare nye kompetanser og kvalifikasjoner vises som tette avhukingsrader i en arbeidsliste, ikke som kortvegg. Hver rad har avhuking, navn og eventuelt en liten typeindikator. Detaljer åpnes først ved klikk på raden.
- Navnene fordeles i kolonner: én kolonne på mobil, tre på vanlig desktop, fire på bred desktop.
- Alle handlingsbare nye forslag er avhuket ved start.
- Allerede registrerte, motstridende, avviste og teknisk feilede forslag ligger i egne seksjoner og er ikke forhåndsvalgt.
- Filtrering og søk endrer kun hva som vises. Avhukinger beholdes for forslag som filtreres bort, og gjenopprettes når filteret fjernes.
- «Godkjenn og overfør» krever en eksplisitt bekreftelsesdialog som viser antall valgte per type før noe overføres.
- Massehandlinger: godkjenn og overfør, behold det jeg har, avvis, utsett. Hvert forslag kjøres for seg, slik at én feil verken fjerner eller endrer valget på de andre.
- Etter kjøring vises eksakt resultat: antall overført, allerede registrert, avvist, utsatt og feilet, med sanitert forklaring på det som feilet og mulighet til å åpne på nytt.
- Enkeltdialogen beholdes for forslag som krever et reelt valg (motstrid, oppdatering av felt som allerede er utfylt).
- Ingen automatikk: ingenting overføres uten at brukeren har bekreftet.

Språk og duplikater:

- Bekreftet feil: forslaget «English» står som `promotion_failed`. Hendelsesloggen viser to forsøk mot karriereporten med feilkoden «Kildegrunnlaget mangler verdi». Årsaken er ruting — forslaget har domenet `career`, mens klienten velger port ut fra domenet alene. Innholdet er en språkkvalifikasjon og hører hjemme i kvalifikasjonsporten, som i dag bare godtar domenene `learning` og `profile`.
- Porten velges heretter ut fra innholdstype først: språk, sertifisering, utdanning og kurs går alltid til kvalifikasjonsporten, som utvides til å godta domenet `career` for disse typene.
- Språk normaliseres til en stabil kanonisk nøkkel (`language:en`, `language:nb`), ikke bare visningsnavn. Nøkkelen utledes fra både engelsk og norsk skrivemåte, og visningsnavnet lagres på bokmål.
- Finnes allerede et aktivt språkatom med samme kanoniske nøkkel, skrives ingenting. Brukeren har «Engelsk» og «Norsk» fra før, så «English» skal gjenbruke det eksisterende atomet.
- Utfallet i et slikt tilfelle er «allerede registrert / behold det jeg har» — ikke `promotion_failed`, og ingen feilhendelse.

## Tekniske detaljer

- Migrasjon (kun funksjonsendring, additiv): kvalifikasjonsporten utvides med domenet `career`, kanonisk språknøkkel og duplikatsjekk mot aktive språkatomer. Ved treff returneres et kontrollert «allerede registrert»-utfall som setter forslaget til beholdt, ikke feilet.
- `src/lib/linkedin/promotion.ts`: portvalg tar hensyn til innholdstype; nytt utfall får norsk forklaring og egen visning.
- `src/routes/_authenticated/kildegjennomgang.tsx`: seksjoner, rutenett, avhuking som overlever filtrering, massehandlinger og resultatoppsummering.
- `src/routes/_authenticated/nettverk.selskaper.$id.tsx`: åtte-dimensjons innsiktspanel med adskilt KI og brukerscore, samt registernøkkeltall via eksisterende arbeidsgiverdetalj-RPC og eksisterende nøkkeltallskomponenter.
- Ingen endringer i RLS, grants, importlogikk, datamodell eller direkte lesing mot registertabellene. Ingen `anon`-tilgang legges til.

## Verifikasjon

- Spørring mot promoteringshendelser: språkforslaget gir ikke lenger `empty_source_value`, oppretter ikke duplikat av «Engelsk», og ender som allerede registrert.
- Massehandling testes i innlogget økt med telling før og etter, inkludert ett bevisst feilende forslag for å bekrefte at øvrige valg står.
- Selskapsdetalj kontrolleres visuelt for ett selskap med analyse og organisasjonsnummer, og ett uten.
