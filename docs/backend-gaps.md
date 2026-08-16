
## Markedsdekkende utvalgsstatistikk (mangler)

Utvalgsinnsikt-panelet på `/arbeidsgivere` er fjernet. Det beskrev bare radene på
gjeldende side (typisk 13 av flere hundre treff), valgt av rangeringen og ikke av
representativitet, og motsa ansattebanneret som er markedsdekkende.

For å gi ekte statistikk over et helt søkeresultat trengs en summary-RPC på linje med
`public.employer_ansatte_distribution`: samme filterparametre som `search_employers`,
men aggregater (bransjefordeling, geografi, risikoflagg, økonomiske medianer) beregnet
over hele treffmengden med eksplisitt merking når den beregnes over et utvalg. Den
finnes ikke i dag. Risikoflagg er i mellomtiden eksponert som et rent tabellfilter
("vis kun selskaper med flagg"), som ikke påstår å være statistikk.

## documents.company_name er fritekst uten nøkkel mot companies (teknisk gjeld)

`public.documents` knytter et dokument til en arbeidsgiver via `company_name` (fritekst)
og indirekte via `application_id`. Det finnes ingen `company_id`-kolonne mot
`public.companies`. Koblingen er dermed navnebasert: skrivevarianter, suffikser
(«AS», «ASA») og navneendringer i Brønnøysund gir treff som ikke kan verifiseres.

Dette er samme mønster som `contacts` hadde da den bare pekte på `application_id`
i stedet for `company_id`.

Konsekvens i dag: arbeidsgiveranalyser lagret som dokumenter kan ikke med sikkerhet
plasseres på riktig selskapsside under Marked. Frontend håndterer det ved å vise en
egen gruppe «Arbeidsgiveranalyser» for dokumenter uten sikker kobling, slik at ingenting
skjules.

Rettes ikke nå. Riktig fiks er en `company_id uuid references public.companies(id)`
på `documents`, med engangs-backfill fra navn der treffet er entydig, og skriving av
`company_id` ved generering av nye analyser.

## Motivasjonsskalaene i `user_career_profiles` er skjult, ikke slettet

Kolonnene `stability_vs_growth`, `mission_importance`, `innovation_importance`,
`sustainability_importance`, `work_life_balance_importance`,
`compensation_importance` og `leadership_ambition` (skala 1–6) finnes fortsatt,
med data for eksisterende brukere. Skjemaet på Karriereprofil er fjernet fra
grensesnittet 2026-08-16 fordi ingen leser dem: verken
`score-pending-opportunities`, `fetch-careerjet-listings` eller
`analyze-company` henter kolonnene.

For å ta dem i bruk må tre ting på plass:

1. `loadProfileAndEvidence` i `score-pending-opportunities` må selecte dem og
   sende dem inn i `profileAi`-konteksten eller i en eksplisitt vekting.
2. Vektingen må dokumenteres i scoringkontrakten og gi utslag i
   `MATCH_SCORE_VERSION` (bump kreves, ellers blir gamle og nye scorer blandet).
3. Skjemaet må tilbake i grensesnittet med en forklaring på hva skalaen faktisk
   påvirker — ikke «brukes senere».

Fjern dette avsnittet den dagen skalaene har en leser.
