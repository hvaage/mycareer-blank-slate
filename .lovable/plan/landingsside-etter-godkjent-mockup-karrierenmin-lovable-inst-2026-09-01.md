# Landingsside etter godkjent mockup (karrierenmin-lovable-instruks.md)

## Mål
Bygg om forsiden (`/`) slik at den følger den godkjente mockupen i instruksen, seksjon for seksjon. Kun presentasjon av landingssiden endres — ingen backend, ingen app-funksjonalitet røres.

**Beslutning (bruker):** «Logg inn» → `/login`, «Kom i gang gratis»/CTA-knapper → `/signup` (ekte auth, ikke placeholder).

## Endringer

### 1. Design-tokens (`src/styles.css`)
Legg inn paletten fra instruksen som tokens (oklch): background `#FAFAF7`, background-alt `#F4F1EC`, foreground `#1A1F2B`, muted/subtle-tekst, border `#E6E2DB`/`#EEEAE2`, primary `#3A6CB0`, primary-icon/chip, success `#3F8F5D`, danger `#B14545`, accent-orange, dark-seksjonstokens (`#181F2C` m.m.). Eksisterende tokens beholdes; landingssidens spesifikke verdier legges som nye/overskrevne tokens slik at app-sidene ikke brekkes visuelt.

### 2. Farger/komponenter på forsiden
Skrives om til å matche instruksen punkt for punkt:

1. **Toppbjelke** (`AnnouncementBar`): blå prikk + «Under bygging» + «Lanseres i september 2026.»
2. **Header**: eksakt logo-SVG fra instruksen (26×26), «karrieren**min**.no» («min» i primary, «.no» 40 % opacity). Nav: Hva (`#hva`), Annerledes (`#annerledes`), Markedsinnsikt → peker til eksisterende rute `/markedsinnsikt` (finnes i prosjektet; alternativet `#markedsinnsikt`-anker droppes). «Arbeidsgivere»-lenken **fjernes** (instruksens hull-punkt 1). Hamburger-meny under 768 px.
3. **Hero**: to kolonner. Venstre: eyebrow, H1 «Ikke bare et CV-verktøy. Systemet som dokumenterer karrieren din.», ingress, knapper «Kom i gang gratis» (→ `/signup`) og «Se hvordan det fungerer» (scroller til `#hva`), tillitslinje med prikkskilletegn. Høyre: opplastet bilde `hero-woman-meeting-highres.jpg` (Lovable Asset, `width:100%; height:auto`, **aldri beskåret**, 12 px runding) + «Din karrierelogg»-kort med tre eksempelpunkter, «Eksempel»-badge og penn-fotnote.
4. **«Ikke enda en CV-generator»** (`#annerledes`, background-alt): to kort, X-punkter (danger) vs. sjekk-punkter (success).
5. **«Et system for hele karrieren»** (`#hva`): fire kort med ikon-chips (Activity, Compass, Target, Users).
6. **Mørk teaser-seksjon** («Fire ting du kan sjekke allerede i dag», `id="markedsinnsikt"`, dark-bg): 2×2 grid — Arbeidsgiveranalyse (Building2), Vurderinger (Star, sitat), Behov i ditt område (MapPin, progresjonsbarer), Lønn per stilling (CreditCard). Merk: eksempeldata er tydelig merket «Eksempel» — ingen reelle markedstall uten kilde (overholder minneregel om markedstall).
7. **CTA-seksjon**: «Klar til å begynne å dokumentere?» + knapp → `/signup`.
8. **Footer**: background-alt, logo 18 px, «© 2026 karrierenmin.no».

Ikke-spesifisert: Lucide-ikoner (ingen emoji), ingen nye seksjoner, ingen fast pikselhøyde på hero-bildet.

### 3. Bilde som asset
`hero-woman-meeting-highres.jpg` lastes opp via `lovable-assets` fra `/mnt/user-uploads/` og refereres via pointer-URL. Alt-tekst fra instruksen.

### 4. Opprydding
Landing-komponenter som ikke lenger brukes etter omskrivingen (f.eks. `Problem`, `BeforeStart`, `UseCases`, `How`, `PageHero` hvis overflødige) fjernes fra `src/routes/index.tsx`; ubrukte filer slettes kun hvis de ikke brukes andre steder (verifiseres med `rg`).

### 5. Tekniske detaljer
- Skrifter: IBM Plex Sans + Plex Mono er allerede lastet i `__root.tsx` — beholdes (Instrument Serif beholdes for appen, brukes ikke på landingssiden).
- Responsivitet per instruks §Responsivitet (1024 px/768 px breakpoints).
- Head-metadata på `/` beholdes/oppdateres med norsk tittel/beskrivelse; canonical og og:url peker på `https://karrierenmin.no/`.

## Verifikasjon
1. `rg` for å sikre at slettede komponenter ikke brukes andre steder; typecheck grønn.
2. Playwright: skjermbilde av forsiden desktop (1280 px) og mobil, sammenlignet mot instruksens seksjoner; sjekk at hero-bildet vises i sin helhet.
3. Klikk-test: «Logg inn» → `/login`, «Kom i gang gratis» → `/signup`, ankerlenker scroller riktig.
