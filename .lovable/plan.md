# Min profil ryddes — og «Kildeimport» / «Kildegjennomgang» erstatter CV-flyten

## Del 1: Menyen (Min karriere)

Alle punkter blir likestilte, ingen innrykk:

```text
Min karriere
  Min profil          -> /min-profil        (viser «Om meg»-innholdet)
  Karriereoversikt    -> /karriere/erfaring
  Kildeimport         -> /kildeimport       (het «Importer eksisterende CV»)
  Kildegjennomgang    -> /kildegjennomgang  (het «CV-gjennomgang», vises når noe venter)
  Min dokumentasjon   -> /documentation
```

«Om meg» og «AI-forslag» forsvinner som egne menypunkter: Om meg-innholdet ligger på Min profil, AI-forslag blir en del av Kildegjennomgang.

## Del 2: Siden /min-profil

Fjernes fra siden:
- boksene «Karriereretning», «Erfaring og roller», «Resultater og kompetanse», «Utdanning og kvalifikasjoner» (de pekte bare nedover på samme side)
- varselkortet «X elementer venter på gjennomgang»
- seksjonene «Karriereretning», «Karriereoversikt» og «CV og dokumentasjon»

Siden viser i stedet «Om meg» — de samme redigerbare svarene som i dag ligger på /about-me. /about-me beholdes som redirect til /min-profil.

## Del 3: Kildeimport

Overskrift: «Kildeimport». Én seksjon som heter **Kilder**, der alle kildene er likestilte kort:

1. Import av eksisterende CV (opplasting + analyse, som i dag)
2. Import fra Arbeidsgiver (ny)
3. LinkedIn
4. Generelle stillingskompetanser (ESCO)
5. Utdanningsretninger og kompetanser
6. Kurs og sertifiseringer

«CV-gjennomgang»-kortet fjernes fra kildelisten — gjennomgang er nå en egen meny.

### Import fra Arbeidsgiver (nytt)

Egen side der brukeren laster opp eller registrerer dokumenter fra arbeidsgiver og klassifiserer dem:

- Referat fra medarbeidersamtale
- 1-til-1-samtale
- KSO
- OKR
- Salgsmål
- Prosjektbeskrivelse
- Kvartalsmål
- Årsbudsjett
- Annet

Hver oppføring har: type, tittel, arbeidsgiver/rolle den hører til, periode, målsetting, **oppnådd resultat** (fritekst + tall), og vedlagt dokumentasjon (fil). Oppføringene blir kandidater — de går til Kildegjennomgang og blir først del av karriereoversikten når brukeren bekrefter dem, i tråd med evidensprinsippet.

## Del 4: Kildegjennomgang

`/career/cv-review` blir `/kildegjennomgang` og dekker alle kilder, ikke bare CV:

- Toppen viser hvilke kilder som har noe å gå gjennom (CV, arbeidsgiverdokumenter, LinkedIn, utdanning), med antall.
- CV-kilden beholder den kjente 4-trinns flyten (roller, resultater, kompetanser, kvalifikasjoner).
- Arbeidsgiverkilden får en tilsvarende gjennomgang: koble dokument til rolle, bekreft målsetting og oppnådd resultat som resultat-atom, med dokumentet som belegg.
- **AI-forslag** blir en fane/seksjon inne i Kildegjennomgang i stedet for eget menypunkt; /career/atom-review beholdes som redirect.

## Teknisk

- `src/components/app-sidebar.tsx`: fjern `indent`, fjern «Om meg» og «AI-forslag», nye labels/stier.
- `src/routes/_authenticated/min-profil/index.tsx`: fjern statusbokser, varsel og seksjoner; render Om meg-innholdet. `src/routes/_authenticated/about-me.tsx` → redirect.
- Nye ruter: `/kildeimport` (flytter innholdet fra `min-profil/importer-cv.tsx`), `/kildeimport/arbeidsgiver`, `/kildegjennomgang`. Gamle stier (`/min-profil/importer-cv`, `/career/cv-review`, `/career/atom-review`) beholdes som redirects.
- Ny tabell for arbeidsgiverkilder (type, tittel, periode, mål, oppnådd resultat, rolle-kobling, dokument-referanse) med RLS + GRANTs, samt filopplasting til eksisterende dokumentlagring. Kandidatene mates inn i gjennomgangsflyten på samme måte som CV-kandidater.
- Ingen endringer i selve CV-analysepipelinen.

## Rekkefølge

1. Del 1 + 2 (meny og Min profil-opprydding) — ren frontend.
2. Del 3 uten Arbeidsgiver-kilde (omdøping, «Kilder»-listen).
3. Import fra Arbeidsgiver (database + skjema + opplasting).
4. Kildegjennomgang: samle CV-flyt, arbeidsgiverflyt og AI-forslag.
