# Ny informasjonsarkitektur og grunnlagsoversikt

Prosjektreferanse bekreftes i hver delrapport: **miwzhbludgwvskmsfqnq**.

Ren frontend og navigasjon. Ingen skjemaendringer. Leveres i syv trinn med rapport mellom hvert.

## Ny menystruktur

```text
Hjem
Min karriere
  Oversikt
  Erfaring og kompetanse
  Karriereprofil
  Mål og utvikling        (kun tom tilstand inntil fase 3)
  Dokumentasjon
  Til gjennomgang (n)
Marked
Jobber
Søknader
Nettverk                  (kommer senere)
--
Innstillinger
  Integrasjoner
  Konto
Admin                     (kun admin)
```

Arkiv utgår som toppnivå. Om meg utgår som samleside.

## Trinn 1 — Integrasjoner og Konto til Innstillinger

Nytt sidebar-punkt Innstillinger nederst med Integrasjoner (eksisterende side) og Konto (kontofanene som i dag ligger under Om meg: varsling, passord, sletting). Om meg mister disse fanene. Gamle stier beholdes som redirect.

## Trinn 2 — Én dokumentasjonsflate, arbeidsgiveranalyser til Marked

Min dokumentasjon og Dokumenter slås til én side «Dokumentasjon» under Min karriere: filer, bibliotek, pakker. Case og resultater utgår som fane.

Arbeidsgiveranalyser filtreres ut av dokumentlisten og lenkes fra selskapets side under Marked (og fra søknaden de ble laget for). Generell CV vises under Min karriere; stillingstilpasset CV og søknadsbrev vises på den enkelte søknaden.

## Trinn 3 — Én opplasting, analyse som handling

Opplasting skjer kun under Dokumentasjon. Hver fil får radhandlinger: «Analyser til karrieredata», «Koble til utdanning/rolle», last ned, slett. Analysen starter samme flyt som i dag (import → kandidater → gjennomgang).

Karriereoversikt-fanen slutter å ta imot filer og peker til Dokumentasjon. Begge gule advarsler fjernes.

## Trinn 4 — Til gjennomgang som kø

AI-forslag døpes om til «Til gjennomgang» med teller i menyen. Køen samler: CV-kandidater, regelbaserte forslag, spørsmål om kompetanse uten belegg, ønsker eldre enn 12 måneder, mål som har passert frist, begrensninger nær valid_to. Én liste med filter per type, én avgjørelse per element.

## Trinn 5 — Grunnlagsoversikten (størst)

Ny side «Erfaring og kompetanse» som viser og redigerer alt av kind `evidens`, i rekkefølgen roller → resultater → kompetanse → kvalifikasjoner → eksponering → verktøy.

Hierarkisk visning per rolle med nestede resultater, kompetanse som hviler på rollen (med antall belegg), og avledet eksponering. Kvalifikasjoner og verktøy i egne grupper under.

Per element vises: manglende belegg, attestasjon (selvrapportert / dokumentert / bekreftet av leder / bekreftet av tredjepart), ikke bekreftet, kilde (importert, manuelt, godkjent forslag). Utdatert vises kun for ønske, verdi og mål.

Handlinger: rediger, slett, bekreft, koble dokumentasjon; «legg til nytt» per gruppe.

- Sletting viser alltid følgene først: hvilke barn som forsvinner, hvilken eksponering som faller bort, hvilke kompetanser som mister sitt eneste belegg.
- Redigering av et bekreftet atom varsler før lagring at confidence faller tilbake fra verified.
- Manuell registrering følger ontologien: kompetanse krever peker til minst ett resultat eller én rolle (feltet vises og forklares i skjemaet); eksponering kan ikke opprettes fritt, brukeren må velge rollen den kom fra.

Karriereprofil får samme mønster for ønske, verdi og begrensning, gruppert med viktighet og gyldighet, der begrensninger tydelig merkes som filtrerende. Mål og utvikling får kun en tom tilstand som forklarer hva som kommer.

## Trinn 6 — Oversikt

Min karriere → Oversikt svarer på «hvor komplett er grunnlaget mitt?»: antall elementer per slag, kompetanser uten belegg, dekningsgrad for attestasjon, antall i gjennomgangskøen, hva som er utdatert. Hvert tall er en lenke til stedet det rettes.

## Trinn 7 — Navneendringer og opprydding

Karriereoversikt → Erfaring og kompetanse. Kort om meg inn i Karriereprofil. AI-forslag → Til gjennomgang. Søknad → Søknader. Om meg og Arkiv fjernes fra menyen; gamle ruter redirecter til nye.

## Teknisk

- Sidebar-grupper i `src/components/app-sidebar.tsx` skrives om til strukturen over; teller for gjennomgang hentes med en egen tellespørring.
- Nye ruter under `src/routes/_authenticated/`: `karriere.index`, `karriere.erfaring`, `karriere.profil`, `karriere.mal`, `karriere.dokumentasjon`, `karriere.gjennomgang`, `innstillinger.*`. Eksisterende ruter (`about-me`, `preferences`, `career/atom-review`, `documentation/*`, `documents/*`, `integrations`) beholdes som tynne redirects for å bevare lenker.
- Innhold gjenbrukes fra dagens `about-me.tsx`, `preferences.tsx`, `career/atom-review.tsx`, `documentation/*` og `documents/*` ved å flytte seksjonene til komponenter, ikke skrive dem på nytt.
- Lesing og skriving går gjennom `src/lib/queries/career-atoms.ts`, `cv-parse-candidates.ts`, `atom-enrichment.ts`, `documentation.ts`. Ingen migrasjoner; attestasjon, klasse og confidence leses som de er.
- Sletting og redigering bruker eksisterende mutasjoner, men får et konsekvens-oppslag foran som teller barn, avledet eksponering og kompetanser uten annet belegg.
