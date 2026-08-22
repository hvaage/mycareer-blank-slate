# Fase 5G — Selskapsinnsikt og skalerbar kildegjennomgang

To leveranser i samme runde: reell arbeidsgiverinnsikt på selskapsdetaljen, og en kildegjennomgang som tåler mange forslag uten feilrouting eller duplikater.

## Del 1 — Selskapsdetalj: innsikt og registerdata

Dagens side har et tomt «Arbeidsgiverinnsikt»-panel og en «Selskapsprofil» med bare navn, bransje, sted og kilder.

Det som faktisk finnes i grunnlaget i dag (bekreftet ved spørring): 8 selskaper, 4 arbeidsgiverrapporter, 9 analysekjøringer. Selskapstabellen har blant annet organisasjonsnummer, bransje, land, størrelsesestimat, eierform, beskrivelse, KI-baserte dimensjonsscorer, aggregerte brukerscorer og en nyere samlet analyse.

Endringer:

- **Selskapsprofil og nøkkeltall** utvides med organisasjonsnummer, eierform, størrelsesestimat, land og kort beskrivelse. Felter uten verdi vises som «Ikke registrert» — aldri tomme eller «null».
- **Arbeidsgiverinnsikt** viser kun reelle analyseresultater: dimensjonsscorer (kultur, ledelse, arbeidsmiljø, karriereutvikling, økonomisk stabilitet, formål), samlet score, når analysen ble kjørt, og antall brukervurderinger bak aggregatet. KI-baserte scorer merkes synlig som KI-generert. Ingen tall vises uten kilde eller tidspunkt.
- Finnes ingen analyse: panelet beholder dagens tomtilstand, med lenke videre til arbeidsgiveranalysen der den finnes.
- Selskaper som bare er kjent via navn fra kontakter (uten oppføring i selskapsregisteret) får uendret adferd: ingen registerdata, ingen status/prioritet.

## Del 2 — Kildegjennomgang: retting og skalerbar behandling

### Bekreftet feil: språkkvalifikasjoner promoteres til feil port

Forslaget «English» ligger som `promotion_failed`. Hendelsesloggen viser to forsøk mot `promote_career_record` med feilkoden «Kildegrunnlaget mangler verdi». Årsaken er ruting: forslaget har domene `career`, og klienten velger port ut fra domenet alene. Innholdet er en språkkvalifikasjon (`language`) og hører hjemme i kvalifikasjonsporten, som i dag bare godtar domenene `learning` og `profile`.

Retting:

- Porten velges ut fra innholdstype først, deretter domene: `language`, `certification`, `education` og `course` går alltid til kvalifikasjonsporten.
- Kvalifikasjonsporten utvides til å godta domenet `career` for disse typene. Ingen andre domener eller typer åpnes.
- Kvalifikasjonsporten normaliserer språknavn til norsk (English → Engelsk) før skriving, i tråd med at all brukervendt tekst er på bokmål.
- Duplikatvern: finnes allerede et aktivt språkatom for samme språk, gjennomføres ingen skriving. Forslaget får en tydelig melding om at kvalifikasjonen allerede finnes, og kan avsluttes med «Behold det jeg har». Brukeren har allerede «Engelsk» og «Norsk» registrert, så nettopp dette forslaget skal ende slik.
- Ingen automatisk promotering, ingen endring av eksisterende atomer.

### Skalerbar gjennomgang

I dag ligger 115 forslag til gjennomgang, hvorav 94 er kompetanser. Kortlisten med dialog per forslag er ikke brukbar i den skalaen.

- Kompetanser (og andre typer med mange like forslag) vises som en kompakt liste med avkryssing, ikke som ett stort kort per forslag.
- Handlinger kan gjøres på et utvalg: godkjenn for overføring, behold det jeg har, avvis, utsett. Hver handling kjøres som enkeltbeslutninger per forslag, slik at ett avvist forslag ikke velter resten.
- Resultatvisning etter kjøring: antall behandlet, antall feilet, og hvilke som feilet med sanitert forklaring. Feilede forslag kan åpnes på nytt.
- Filtre på type og status, og en tydelig teller «X av Y gjenstår».
- Dialogen beholdes for enkeltforslag som krever et valg (motstrid, mulig oppdatering av eksisterende felt).
- Fortsatt ingen automatikk: ingenting overføres uten at brukeren har trykket bekreft.

## Tekniske detaljer

- Migrasjon (additiv, kun funksjonsendring): `linkedin_promote_qualification` utvides med domenet `career`, språknormalisering og duplikatsjekk mot aktive `career_atoms` med `atom_type = 'language'`. Returnerer kontrollert feilkode ved duplikat i stedet for å skrive.
- `src/lib/linkedin/promotion.ts`: `promotionActionForDomain` får med innholdstype fra forslagets payload; ny feilkode får norsk forklaring.
- `src/routes/_authenticated/kildegjennomgang.tsx`: masseutvalg, filtre, resultatoppsummering.
- `src/routes/_authenticated/nettverk.selskaper.$id.tsx`: utvidet selskapsprofil og reell arbeidsgiverinnsikt.
- Ingen endringer i RLS, grants, importlogikk eller datamodell utover funksjonsendringen over. Ingen `anon`-tilgang legges til.

## Verifikasjon

- Spørring mot promoteringshendelser: språkforslaget skal ikke lenger gi `empty_source_value`, og skal ikke opprette et duplikat av «Engelsk».
- Masseutvalg testes mot reelle forslag i innlogget økt, med telling før/etter.
- Selskapsdetalj kontrolleres visuelt for et selskap med analyse og ett uten.
