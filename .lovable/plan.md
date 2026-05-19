# Kopiere AccountAngleAgent inn under `/selskapsanalyse` (norsk versjon)

Mål: Få AccountAngle-landingssiden tilgjengelig som en underside på `karrierenmin.no/selskapsanalyse`, med **all tekst oversatt til norsk**, henvendt til norske brukere. Beholder visuell stil siden AccountAngle allerede er rebrandet i samme stil som karrierenmin.no.

## Hva som kopieres fra AccountAngleAgent

Landingssiden (`src/routes/index.tsx`), pluss støttekomponentene:

- `src/components/lead-form.tsx` — skjema som sender lead
- `src/components/dimensions-radar.tsx` — Recharts radar-graf
- `src/lib/site.ts` — site-konstanter
- Server function `src/server/leads.functions.ts` → flyttes til `src/lib/leads.functions.ts` (Karrierenmin sin konvensjon for client-importable server functions)
- Public API-ruter `src/routes/api/public/download.ts` og `skill-zip.ts` (skill-nedlasting)
- Statiske filer fra `public/` (eks. `sample-equinor-report.pdf`, skill-bundle)

Hopper over: `site-chrome.tsx` (Karrierenmin har egen Header/Footer), admin-rutene (`admin.*`), `example.tsx`, `privacy.tsx`, `thank-you.tsx` — kan legges til senere.

## Nye filer i karrierenmin

```
src/routes/
  selskapsanalyse.tsx              ← hovedside (port av AccountAngle index.tsx)

src/components/selskapsanalyse/
  LeadForm.tsx                     ← norsk versjon
  DimensionsRadar.tsx              ← akser på norsk

src/lib/
  leads.functions.ts               ← server function for lead-innsending
  selskapsanalyse-site.ts          ← norske konstanter (dimensjoner, land, steg)

src/routes/api/public/
  selskapsanalyse.download.ts      ← skill-nedlasting (signert lenke)
  selskapsanalyse.skill-zip.ts     ← serverer skill-bundle

public/selskapsanalyse/
  eksempel-equinor-rapport.pdf
```

## Norsk oversettelse

All tekst skrives om til norsk og tilpasses norsk målgruppe. Eksempler:


| Engelsk (original)                                                   | Norsk                                                                                                                                                                                         |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Know what you're walking into before you sign."                     | "Vit hva du går til før du signerer."                                                                                                                                                         |
| "Account Angle Agent turns hours of employer research..."            | "Selskapsanalysen gjør timer med arbeidsgiver-research om til en godt dokumentert PDF-rapport — i åtte dimensjoner, ekte kilder, klar til en 20-minutters gjennomlesning før neste intervju." |
| "Free Claude skill · from karrierenmin.no"                           | "Gratis Claude-ferdighet · fra Karrierenmin.no"                                                                                                                                               |
| "Get the skill — free"                                               | "Hent Claude skillen — gratis"                                                                                                                                                                |
| "See an example →"                                                   | "Se et eksempel på en selskapsanalyse→"                                                                                                                                                       |
| "Built for Claude / 16 European countries / PDF, every source cited" | "Bygget for Claude / 16 europeiske land / PDF med alle kilder oppgitt"                                                                                                                        |
| "Glassdoor stars don't tell you who you'll work for."                | "Glassdoor-stjerner forteller deg ikke hvem du faktisk skal jobbe for."                                                                                                                       |
| "What every report covers"                                           | "Hva hver rapport dekker"                                                                                                                                                                     |
| "How it works"                                                       | "Slik fungerer det"                                                                                                                                                                           |
| "Give it a domain and country"                                       | "Oppgi domene og land for selskapet"                                                                                                                                                          |
| "Claude runs the research"                                           | "Claude utfører undersøkelsen"                                                                                                                                                                |
| "Get a sourced PDF report"                                           | "Få en godt dokumentert PDF-rapport"                                                                                                                                                          |
| "Built for 16 European labour markets."                              | "Bygget for analyser av selskaper i 16 europeiske arbeidsmarkeder."                                                                                                                           |
| "Walk into your next interview knowing more than they expect."       | "Start neste intervju med grundig forkunnskap om din mulige nye arbeidsgiver."                                                                                                                |
| "Free. No credit card."                                              | "Gratis. Ingen betaling eller kortinformasjon nødvendig."                                                                                                                                     |


Åtte dimensjoner oversettes: Kultur og verdier, Lederskapskvalitet, Arbeidsmiljø, Karriereutvikling, Finansiell stabilitet, Misjon og formål, Talenttiltrekning, Mangfold og inkludering.

Land-listen beholdes som norske navn: Norge, Sverige, Danmark, Finland, Island, Tyskland, Østerrike, Sveits, Nederland, Belgia, Luxembourg, Frankrike, Storbritannia, Spania, Portugal, Italia.

Lead-skjemaets labels, validering-meldinger, feilmeldinger og takke-tekst oversettes også.

Navn på produktet: vi bruker **"Selskapsanalyse"** som hovedtittel på siden (norsk), og kan referere til "Account Angle Agent" som det engelske navnet på Claude-ferdigheten i selve nedlastings-/installasjonskontekst.

## Visuell stil

Siden AccountAngle allerede er rebrandet i samme stil som karrierenmin.no:

- Behold styling og layout som det er — port-en blir nesten 1:1 visuelt
- Kun nødvendige tilpasninger: bruk Karrierenmin sine eksisterende `Header`/`Footer`-komponenter, og Karrierenmin sin `Button` der det er naturlig, samt karrierenmin sin logo
- CSS-tokens (`--primary`, `--background`, `--border` osv.) er allerede kompatible siden begge prosjekter deler samme palett

## Avhengigheter som må installeres

Karrierenmin har allerede Radix/shadcn. Må legges til:

- `recharts` (for radar-grafen)
- `zod` (sjekk om allerede til stede; brukes til input-validering i lead-skjemaet)

## Backend / Lovable Cloud

Karrierenmin har allerede Lovable Cloud aktivert. Vi:

1. Lager `leads`-tabell i Karrierenmin sin database med samme skjema som AccountAngle bruker (id, navn, epost, linkedin_url, utm-felter, opprettet_dato, kilde)
2. Setter opp RLS-policyer: kun insert tillatt for anonyme (skjemainnsending), select kun for admin
3. Lead-server-function lagrer i denne tabellen

## E-post via Lovable Emails

Når noen sender inn lead-skjemaet:

1. **Bekreftelse til brukeren** (transactional): kort norsk e-post med takk, lenke til skill-nedlasting, og oppfordring til å koble seg til Karrierenmin på LinkedIn
2. **Varsel til admin** (transactional): notifikasjon med lead-detaljer

Krever:

- Lovable Cloud (allerede aktivert)
- Oppsett av e-postdomene for `karrierenmin.no` via Lovable Emails (sender-subdomene, f.eks. `notify.karrierenmin.no`) — settes opp gjennom Lovable sin domene-setup-dialog
- E-post-infrastruktur (kø, dispatcher, suppression-tabeller) — opprettes automatisk av Lovable
- To React Email-maler under `src/lib/email-templates/`:
  - `selskapsanalyse-bekreftelse.tsx` (til brukeren)
  - `selskapsanalyse-admin-varsel.tsx` (til admin)
- Maler registreres i `src/lib/email-templates/registry.ts`
- Lead-server-function kaller `sendTransactionalEmail` for begge etter vellykket lagring

Hvis e-postdomene ikke allerede er konfigurert, viser jeg sender-domene-oppsett-dialog først som en del av implementeringen.

## Header-nav

Legger til `Selskapsanalyse` i `src/components/landing/Header.tsx` sin `navItems`, peker til `/selskapsanalyse`.

## SEO

- `head()` på `/selskapsanalyse` med norsk `title`, `description`, `og:*`
  - Title: `Selskapsanalyse — Karrierenmin`
  - Description: kort norsk beskrivelse av hva rapporten dekker
- Oppdaterer `sitemap[.]xml.ts` til å inkludere `/selskapsanalyse`
- Canonical: `https://karrierenmin.no/selskapsanalyse`
- `lang="no"` er allerede satt i `__root.tsx`

## Tekniske detaljer

- Server functions må flyttes ut av `src/server/`-mappen (Karrierenmin sin import-protection blokkerer den fra client bundle) til `src/lib/*.functions.ts`
- Recharts kjører kun client-side — wrappes i en client-only sjekk om SSR-feil oppstår
- `/api/public/*`-ruter beholder samme stabile URL-struktur

## Hva som IKKE er med

- `accountangle.com` blir ikke nedlagt eller redirected (kan gjøres etterpå)
- Admin-flate for å se leads (port `admin.*` senere ved behov)
- `/example`-siden med full PDF-preview
- Personvernerklæring-side (kan kopieres og oversettes senere)

## Estimat

Ca. 15–18 filendringer, inkludert oversettelse, e-postmaler og databaseoppsett. Hovedrisiko: e-postdomene må verifiseres (kan ta opp til 72 timer for DNS), men skjemainnsending og lagring fungerer uansett umiddelbart.