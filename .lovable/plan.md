# Rydd opp «Min profil» og løft menypunktene

## Slik blir det

### Menyen (Min karriere)
Alle punkter blir likestilte, ingen innrykk:

```text
Min karriere
  Min profil            -> /min-profil        (viser «Om meg»-innholdet)
  Karriereoversikt      -> /karriere/erfaring
  Importer eksisterende CV -> /min-profil/importer-cv
  CV-gjennomgang        -> /career/cv-review  (vises kun når noe venter)
  Min dokumentasjon     -> /documentation
  AI-forslag            -> /career/atom-review
```

Endring fra i dag: «Om meg» forsvinner som eget punkt (innholdet ligger på Min profil), og Karriereoversikt / Importer eksisterende CV / CV-gjennomgang er ikke lenger underpunkter av Min profil.

### Siden /min-profil
Fjernes helt fra siden:
- boksene «Karriereretning», «Erfaring og roller», «Resultater og kompetanse», «Utdanning og kvalifikasjoner» (de pekte bare nedover på samme side)
- varselkortet «X elementer venter på gjennomgang»
- seksjonene lenger ned: «Karriereretning»-oppsummeringen, «Karriereoversikt» (tellere, rollelister, kompetansemerker) og «CV og dokumentasjon»

Nytt innhold på siden: «Om meg» — de samme redigerbare svarene som i dag ligger på /about-me (bakgrunn, situasjon, ønsker, karriereretning), uendret funksjonalitet.

Ingen informasjon går tapt: erfaring/resultater/kompetanse ligger på Karriereoversikt, dokumenter på Min dokumentasjon, importstatus på Importer eksisterende CV / CV-gjennomgang.

### Om /about-me
URL-en beholdes og sender videre til /min-profil, slik at gamle lenker og knapper i appen fortsatt virker.

## Teknisk

- `src/components/app-sidebar.tsx`: fjern `indent` på de tre punktene, fjern «Om meg»-punktet, behold betinget innsetting av «CV-gjennomgang».
- `src/routes/_authenticated/min-profil/index.tsx`: fjern statusboksene, gjennomgangsvarselet og de tre seksjonene; render «Om meg»-innholdet (komponenten som i dag brukes av `about-me.tsx`) i stedet. Beholder rutens `head()`-metadata.
- `src/routes/_authenticated/about-me.tsx`: gjøres om til redirect til `/min-profil` (beholder `tab`-parameteren om nødvendig).
- `src/lib/queries/profile-overview.ts` blir ubrukt av denne siden; fjernes bare hvis ingen andre bruker den.
- Ingen databaseendringer.
