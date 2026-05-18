# Karrierenmin – landing page

Frontend-only landing page på `/`. Rolig, profesjonell, tillitsvekkende norsk stil.

## Designsystem (`src/styles.css`)

Oppdater `:root` til ny palett (oklch):
- `--background`: nær-hvit `oklch(0.99 0.003 250)`
- `--foreground` / `--primary`: dyp navy `oklch(0.22 0.05 255)`
- `--accent`: dempet blå `oklch(0.50 0.10 250)`
- `--muted`: lys kjølig grå `oklch(0.97 0.005 250)`
- `--border`: `oklch(0.92 0.008 250)`
- `--radius`: `0.5rem`
- Ingen gradienter, ingen glow

## Typografi (`src/routes/__root.tsx`)

- Google Fonts links: Instrument Serif (headings) + Inter (body)
- `lang="no"`, oppdater meta (title, description, og:*) til norsk
- Body font-family Inter via inline style eller utility-klasse i body; headings bruker `font-serif`-klasse mappet til Instrument Serif

Legger til i `styles.css`:
- `--font-serif: 'Instrument Serif', serif;`
- `--font-sans: 'Inter', system-ui, sans-serif;`
- Mapping i `@theme inline`

## Komponentstruktur

Splitter i `src/components/landing/`:
- `Header.tsx` – wordmark + nav (Hva, Annerledes, Hvordan, Kom i gang) + CTA "Forstå hvordan det fungerer"
- `Hero.tsx` – H1 (serif), undertekst, to CTA
- `What.tsx` – 4 cards
- `Different.tsx` – 4 cards
- `Problem.tsx` – 4 cards (lett `bg-muted`)
- `How.tsx` – 6 nummererte cards (01–06), grid 3 kolonner
- `UseCases.tsx` – 4 cards
- `BeforeStart.tsx` – sentrert blokk, 3 punkter, én CTA
- `CTA.tsx` – avslutning, to knapper
- `Footer.tsx` – wordmark, kort tagline, e-post, nav

`src/routes/index.tsx` komponerer disse i rekkefølge.

## Layout-detaljer

- Container `max-w-6xl mx-auto px-6`
- Seksjonsspacing `py-20 md:py-28`
- Grid: 4-cards `md:grid-cols-2 lg:grid-cols-4`; 6-stegs `md:grid-cols-2 lg:grid-cols-3`
- Card: shadcn `Card` med subtil border, ikke skyggetung; ikon (lucide outline) i liten boks `bg-accent/10 text-accent`
- How-cards: stort nummer (serif, dempet) over tittel
- Knapper: shadcn `Button` (default = navy primary, outline = sekundær)

## Navigasjon

- Nav-lenker scroller til `#hva`, `#annerledes`, `#hvordan`, `#kom-i-gang` (ankre på seksjoner)
- "Forstå hvordan det fungerer" scroller til `#hvordan` nå; bytte til `/hvordan`-rute senere

## Utenfor scope

Ingen backend, auth, Supabase, integrasjoner eller ekstra ruter.
