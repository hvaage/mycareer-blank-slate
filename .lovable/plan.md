# Bytt ut skill-filen som tilbys for nedlasting

## Mål

Den opplastede `employer-analysis.skill`-filen skal være den faktiske filen som leveres til brukerne av Selskapsanalyse-siden.

## Nåværende tilstand

- Det finnes **ingen skill-fil** i prosjektet ennå (`public/` inneholder bare `llms.txt` og `robots.txt`).
- LeadForm sin "ferdig"-tilstand sier *"Vi har sendt deg en bekreftelse med nedlastingslenke til Claude-ferdigheten"*, men selve nedlastingsendepunktet/-filen er aldri opprettet.
- Bekreftelses-e-posten som skulle inneholde lenken er heller ikke wired opp ennå (e-postinfrastruktur er klar, men maler/sending fra `leads.functions.ts` mangler).

## Endringer

1. **Kopier den opplastede filen** til `public/selskapsanalyse/employer-analysis.skill`. Da serveres den på den stabile URLen:
  ```
   https://karrierenmin.no/selskapsanalyse/employer-analysis.skill
  ```
   Filer i `public/` serveres direkte av Vite/Cloudflare med riktig Content-Disposition for nedlasting.
2. **Ingen kodeendringer trengs for at filen skal være tilgjengelig** — så snart den ligger i `public/`, kan den lastes ned via URLen over.

## Anbefalt oppfølging (ikke del av denne endringen, si ifra hvis du vil ha den med)

Siden brukeropplevelsen i dag lover "nedlastingslenke i e-post", bør vi enten:

- **a)** Wire opp e-postsending i `src/lib/leads.functions.ts` med en React Email-mal som lenker til `/selskapsanalyse/employer-analysis.skill`, **eller**
- **b)** Vise nedlastingsknappen direkte i `done`-tilstanden i `LeadForm.tsx` (raskt og fungerer uavhengig av at e-postdomenet er DNS-verifisert).

Si fra om du vil ha **a**, **b** eller begge med i samme runde — ellers leverer jeg bare filplasseringen nå.   
Jeg ønsker begge. At filen blir tilgjengelig for nedlasting i done -tilstand og at det sendes en email med link.