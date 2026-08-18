# Én logisk plass for CV-er: kilde, arkiv og produksjon

I dag kan samme fil lastes opp to steder (Importgjennomgang og Om meg → CV-filer), CV-er finnes ikke under Min dokumentasjon, og Søknader tilbyr bare søknadsbrev. Forslaget skiller tydelig mellom tre roller en CV kan ha, og gir hver rolle ett sted.

## Prinsippet: tre roller, tre steder

```text
1. KILDE          Importgjennomgang → CV
   Gamle CV-er du laster opp for å bygge karriereoversikten.
   Merkes «Kildedokument — brukes ikke i søknader».

2. ARKIV/OVERSIKT Min dokumentasjon → CV-er
   Ett sted som viser ALLE CV-er: kilde-CV-er (arkivert) og
   genererte CV-er (klare til bruk). Ingen opplasting her,
   bare oversikt, nedlasting, sletting og lenker videre.

3. PRODUKSJON     Søknader → CV-er og søknadsbrev
   Her lages generell CV, stillingstilpasset CV og søknadsbrev.
   Kun det som lages her kan sendes med søknader.
```

## Endringer

### 1. Importgjennomgang (eneste opplastingssted)
- Beholder opplasting + analyse, men teksten gjøres eksplisitt: CV-en brukes som grunnlag for karriereoversikten, den er ikke en søknadsklar CV og vil ikke bli foreslått ved innsending.
- Etter fullført gjennomgang: lenke «Se filen i Min dokumentasjon» og «Lag en søknadsklar CV».

### 2. Om meg → fanen «CV-filer» fjernes
- Opplasting av egne CV-er tas bort her (dublett).
- Fanen erstattes ikke av en tom side: eksisterende lenker/knapper med `?tab=cv` sendes til Min dokumentasjon → CV-er. Filene som allerede ligger lagret på profilen forsvinner ikke — de vises i den nye CV-oversikten.

### 3. Ny side: Min dokumentasjon → CV-er
- Legges inn som eget punkt i dokumentasjonsmenyen og som statuskort på dokumentasjonsforsiden.
- To grupper med tydelige merkelapper:
  - «Kilde-CV-er (arkiv)» — badge `Ikke for innsending`, med importstatus (analysert / venter på gjennomgang) og lenke til gjennomgangen.
  - «Søknadsklare CV-er» — generelle og stillingstilpassede, badge `Klar for innsending`, med språk, dato og eventuell stilling den er tilpasset.
- Handlinger: last ned, slett, «Lag ny CV».

### 4. Søknader får CV-produksjon
- Sidemenyen «Søknader» får punktet «CV-er» (peker til CV-byggeren) over «Søknadsbrev».
- CV-byggersiden får to tydelige innganger: generell CV (norsk/engelsk) og stillingstilpasset CV. (Selve genereringen er fortsatt en stub — dette endrer plassering og forventning, ikke funksjonalitet.)

### 5. Min profil
- Boksen «CV-filer» peker til Min dokumentasjon → CV-er i stedet for Om meg-fanen, og teller både kilde-CV-er og søknadsklare CV-er.

## Meny etter endringen

```text
Min karriere
  Min profil
    Importgjennomgang      ← eneste opplasting av gamle CV-er
  Erfaring og kompetanse
  Min dokumentasjon
    …, CV-er               ← samlet oversikt over alle CV-er
  AI-forslag

Søknader
  CV-er                    ← ny: generell + stillingstilpasset
  Søknadsbrev
  Genererte søknader
  Søknadsstatus
  Neste steg
```

## Teknisk

- Ny rute `src/routes/_authenticated/documentation/cv.tsx` + oppføring i `documentation-layout` og statuskort i `documentation/index.tsx`.
- Ny spørring som slår sammen kilder: opplastede CV-filer (profilkolonnene `cv_*_path` og importfilene bak `cv-archive-sources`) og genererte CV-er (`cv-archive`). Lagringsmodellen endres ikke i denne omgangen; visningen normaliserer feltene til én liste med `origin: "kilde" | "generert"`.
- `about-me.tsx`: fjern CV-fanen og `CvUploader`-bruken der; `validateSearch` beholder `tab=cv` men redirigerer til den nye siden så gamle lenker ikke brekker.
- `app-sidebar.tsx`: legg til «CV-er» i Søknader-gruppen.
- `min-profil/index.tsx`: oppdater «CV-filer»-boksens `to`/`search` og teller.
- `cv-upload-flow.tsx` / `importgjennomgang.tsx`: kun tekst- og lenkeendringer.

## Avklaring

Genererte CV-er er foreløpig en stub. Planen flytter forventningen til riktig sted uten å bygge selve genereringen — den kan tas som neste steg.
