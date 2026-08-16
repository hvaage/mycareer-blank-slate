# CV-gjennomgangen: trinnvis, ikke flat kø

Gjennomgangen av CV-import legges om fra én flat liste med 44 enkeltavgjørelser til
fire trinn som følger kjeden rolle → resultat → kompetanse, med bulk-bekreftelse,
begrunnede forslag og fremdrift.

## Det jeg har verifisert i dagens data og kode

- Gjennomgangen (`/career/cv-review`) er i dag én flat liste bygd av
  `buildCandidateTree`, med én knapp per kandidat.
- Dagens import har 44 kandidater: 6 roller (bekreftet), 23 resultater, 9 kompetanser,
  2 oppsummeringer, 1 frivillig, 1 utdanning, 2 språk.
- Roller har `start_date`/`end_date` i `structured_data`, men to av seks har
  `start_date: 1900-01` og manglende sluttdato — altså placeholderverdier som *ikke*
  skal gi karrierehull.
- Kompetansene har ingen posisjonsinformasjon fra parsen: alle ni har
  `source_category: "other"`, ingen `parent_local_ref`, ingen tidsangivelse.
  Det betyr at «posisjon i dokumentet» og «tidsangivelse» som plasseringssignaler
  ikke finnes i dagens parseresultat.

Konsekvens: automatisk plassering kan i første omgang bare bygge på tekstsignaler
(ordoverlapp mot rolletittel/arbeidsgiver, og treff i resultatteksten under en rolle).
Det gir færre høy-sikkerhet-treff enn instruksens eksempel. Full plasseringskvalitet
krever at parseren bærer seksjon og kildeposisjon videre — det hører til
cv-evidence-graph v2.0 (instruksens punkt 11) og gjøres ikke her. Jeg legger
signalmodellen slik at nye signaler kan kobles inn uten å endre grensesnittet.

## Trinn 1 — tidslinje over hele karrieren

Alle roller vises samtidig, sortert etter periode, med `[Bekreft alle roller]` som
én handling. Roller kan endres og legges til her.

Mulige hull vises kun når begge datoene finnes, har månedspresisjon, ikke er
placeholder (`1900-01`), rollen ikke pågår, perioder ikke overlapper og oppholdet er
minst tre måneder. Ellers vises ingenting.

Ved et mulig hull kan brukeren legge til rolle, velge en kategori (studier,
permisjon, sabbatsår, selvstendig, annet) eller hoppe over. Kategorivalget lagres som
privat tidslinjekontekst — ikke rolle, ikke atom, ikke evidens, aldri med i
CV-, eksport- eller modellgrunnlag. Den kan endres og fjernes senere.

Trinn 2–4 er låst til rollene er bekreftet for denne gjennomgangen. Låsingen er
UI-gating; alt kan rettes senere.

## Trinn 2 — resultater per rolle

Én rolle om gangen med alle resultatene under seg og `[Bekreft alle]` per rolle.
Roller uten resultater får spørsmålet «Hva oppnådde du her?» (valgfritt).
Brukeren kan legge til et resultat; det lagres som brukeroppgitt grunnlag.

## Trinn 3 — kompetanse

Hvert forslag vises ferdig utfylt med rolle, resultat, type og en begrunnelseslinje
som sier hvorfor koblingen ble foreslått. Høy sikkerhet krever minst to uavhengige
signaler. Høy-sikkerhet-forslag samles i én liste med `[Bekreft alle N]`, resten går
én og én. Én kompetanse kan kobles til flere roller og flere resultater uten at det
lages duplikater. Overstyrer brukeren maskinens forslag, beholdes forslaget som
historikk og brukerens valg blir gjeldende.

## Trinn 4 — kvalifikasjoner

Utdanning, sertifisering, språk og verktøy bekreftes samlet.

## Fremdrift og oppstart

Fremdriftslinje gjennom hele flyten med trinnstatus, antall gjenstående og markering
av trinn som må vurderes på nytt fordi en rolle er endret. Etter analyse går brukeren
rett inn i trinn 1 («Gå gjennom nå» / «Senere»). Velger han senere, ligger det i køen
som i dag. Køen beholdes for det som kommer over tid.

## Evidensgrenser (uendret)

Bulk-bekreftelse av parsekandidater oppretter aldri `user_attested`. Attestasjon skjer
bare i den etablerte påstandsgjennomgangen, på eksakt påstandstekst og versjon.
Frontend definerer ingen egne statuser — alle verdier kommer fra den kanoniske
kontrakten. Ingenting slettes ved avvisning.

## Teknisk

Database (én migrasjon, med GRANT og RLS scopet til `auth.uid()`):
- `public.cv_review_timeline_context` — privat hullkontekst: `user_id`, `import_id`,
  `gap_start`, `gap_end`, `category`, `note`, tidsstempler. Leses aldri av
  generering, eksport eller modellinput.
- `public.cv_review_progress` (eller kolonner på `cv_imports`): aktivt trinn,
  trinnstatus, `needs_recheck`-markering per trinn, for gjenopptak.
- Utvidelse av `cv_parse_candidates`: `origin` (`parsed` | `user_added`) og
  `suggestion` (jsonb: `confidence`, `reasons[]`, kildereferanser, opprinnelig
  maskinforslag ved overstyring).

Frontend:
- `src/lib/cv-review-timeline.ts` — periodeparsing, placeholder- og
  presisjonsdeteksjon, hulldeteksjon med reglene over. Ren funksjon, testes direkte.
- `src/lib/cv-review-placement.ts` — signalmodell for kompetanseplassering
  (ordoverlapp, treff i resultattekst, `local_ref`-struktur), `confidence` + `reasons[]`,
  krav om to uavhengige signaler for høy sikkerhet.
- `src/lib/queries/cv-parse-candidates.ts` utvides med bulk-bekreftelse, brukerlagte
  roller/resultater med provenance (`origin`, bruker, tidspunkt, original tekst,
  import-id) og markering av berørte forslag ved rolleendring.
- `/career/cv-review` bygges om til en trinnflyt med fremdriftslinje; dagens flate
  liste beholdes som «Gå gjennom én og én».
- `cv-upload-flow.tsx` sender brukeren rett til trinn 1 etter analyse.

Tester (vitest + kanarier): bulk-bekreftelse gir ikke `user_attested`, provenance på
brukerlagte elementer, rolleendring markerer berørte forslag, placeholder-/usikre
datoer gir ikke hull, privat hullkontekst er utenfor CV- og modellgrunnlag, én
kompetanse med flere pekere gir ikke duplikat, avbrutt gjennomgang gjenopptas på
riktig trinn, frontend bruker bare kontraktverdier.

## Rekkefølge

1. Trinn 1 med tidslinje, hulldeteksjon og brukerlagte roller (+ migrasjon).
2. Direkte oppstart etter analyse.
3. Trinn 2 — resultater per rolle.
4. Trinn 3 — kompetanseplassering med begrunnelse og bulk.
5. Trinn 4 — kvalifikasjoner.
6. Fremdrift, gjenopptak og full testdekning.

Splitting av sammensatte kompetanser og utledning av overordnet kompetanse
(punkt 11) hører til cv-evidence-graph v2.0 og er ikke med her.
Måling (punkt 12) settes opp etter at trinn 1–3 er i drift.
