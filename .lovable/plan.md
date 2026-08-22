# Fase 5C — Nettverksarbeid: detaljer, arbeidsflyt og koblinger

Bygger videre på 5B. Ingen KI-forslag, ingen e-post, ingen automatisk promotering eller sammenslåing. Alt vises kun når data faktisk finnes.

## Verifisert utgangspunkt

- `documents.opportunity_id` finnes allerede, er indeksert, men mangler fremmednøkkel og brukes ikke i dag (0 rader satt). Koblingen må derfor sikres, ikke oppfinnes.
- Annonsekontakt finnes reelt i annonsegrunnlaget: NAV-annonser har `contactList` med navn, tittel, e-post og telefon (funnet i lagrede annonser). Dette er kilden for panelet «Kontaktperson i annonsen».
- Frist leses allerede fra annonsegrunnlaget i mulighetsdetaljen; den beholdes og vises kun når den finnes.
- Panelkomponenten (`NetworkPanel`) har allerede fast overskrift, intern scroll og kollaps til én linje. 5C gjenbruker den overalt.
- `user_opportunities` har `identity_fingerprint` og `canonical_opportunity_id` — nok til idempotent «start søknad» uten dubletter.

## 1. Felles detaljatferd

- Historikkbevisst `← Tilbake` (går tilbake i faktisk historikk med bevart filter; faller tilbake til listen med samme søkeparametre når historikk mangler).
- Desktop: fast arbeidsflate under toppnavigasjonen, panelrutenett med intern scroll — ingen lang vertikal side.
- Mobil: én kolonne, ingen horisontal scroll.
- Alle navn (selskap, kontakt, mulighet, dokument, aktivitet) blir lenker til riktig detalj.
- Én `Logg aktivitet`-knapp per detaljside som åpner eksisterende aktivitetsdialog med kontekst forhåndsvalgt.

## 2. Selskapsdetalj

Toppområde: navn, bransje/sted/organisasjonsnummer når kjent, brukerens status og prioritet, antall kontakter, antall aktive muligheter, neste aktivitet (dato + handling), kilde og hentetidspunkt for registerdata.

Paneler: Selskapsprofil (ingen tomme nulltall — eksplisitt datamangel med årsak), Arbeidsgiverinnsikt (kun reelle analyseresultater, ellers «Ikke analysert ennå» med lenke til arbeidsgiveranalysen når den finnes), Dine kontakter i selskapet (plass til minst to før intern scroll, lenke til kontaktkort, sist observert rolle/relasjon/neste aktivitet), Muligheter (stilling, status, match, neste aktivitet), Aktiviteter (åpne + nylig utførte, `Logg aktivitet` med selskap forhåndsvalgt).

## 3. Kontaktdetalj

Toppområde: navn, sist observert rolle og selskap med lenke, LinkedIn som sekundær observasjon med tidspunkt, manuelle verdier vinner som aktiv verdi.

Paneler: Relasjon (kun brukerens eget notat/relasjon — ingen oppfunnet styrke), Kontaktpunkter (telefon/e-post kun når brukeren selv har lagt dem inn; aldri hentet fra LinkedIn), Muligheter (der kontakten er brukerens kontakt eller annonsekontakt), Aktiviteter og tidslinje (dato først på samme linje, planlagt vs. utført visuelt skilt), Tredjepartsinformasjon (LinkedIn-anbefalinger kun når brukeren eksplisitt har koblet dem, merket som tredjepart, aldri som CV-evidens, ingen endorsement-identiteter).

## 4. Mulighetsdetalj

Overskrift alltid `Stilling · Selskap`, begge visuelt tydelige. Topp: status, frist kun når den finnes i annonsegrunnlaget, separat «Neste aktivitet» (dato, handling, prioritet), preferanse- og kompetansematch separat når beregnet, lenke til original annonse.

Panelrutenett:

```text
Annonseoversikt og neste steg   |  Kontaktperson i annonsen
Dokumenter brukt                |  Dine kontakter i selskapet
Tidslinje                       |  Arbeidsgiverinnsikt
```

- `Åpne annonse` ligger i paneloverskriften til annonseoversikten; dokumentinfo fjernes fra det panelet.
- Kontaktperson i annonsen: navn, rolle, selskap og kontaktinfo som faktisk finnes i annonsekilden, kildeklasse `job_posting`, med knappene `Opprett kontakt` / `Koble til eksisterende kontakt`. Kobling skjer kun ved eksplisitt brukerhandling; navnelikhet foreslår på sin høyde, kobler aldri. Finnes kontakten, lenker navnet til kontaktkortet. Mangler annonsekontakt: kompakt tomtilstand.
- Dokumenter brukt: kun dokumenter eksplisitt koblet til muligheten, hvert med lenke til dokumentdetalj/generert søknad.

## 5. Fra jobbmulighet til søknadsarbeid

Eksplisitt brukerhandling («Søknad» / start CV- eller søknadsbrevarbeid) oppretter eller oppdaterer én idempotent `user_opportunity` på samme annonseidentitet, bevarer annonsekilde og eksisterende matchresultater, lager aldri duplikat, og navigerer til mulighetsdetaljen. Ingen masseautomatikk på importerte annonser.

## 6. Tidslinje

Én felles tidslinjemodell på selskap, kontakt og mulighet: mulighet opprettet, annonse lagret, aktivitet planlagt/utført, søknad opprettet/sendt, intervju planlagt/gjennomført, dokument koblet, brukeroppdatert status. Dato først på samme linje, kilde og tidspunkt bevart i data, ingen fiktive «typiske neste steg», planlagt skilles visuelt fra utført.

## Teknisk gjennomføring

**Migrasjon (additiv):**
- Fremmednøkkel `documents.opportunity_id → user_opportunities(id)` (`on delete set null`) + sammensatt indeks `(user_id, opportunity_id)`. Ingen backfill av eksisterende dokumenter.
- RPC `network_link_document_opportunity(p_user_id, p_document_id, p_opportunity_id)`: validerer at både dokument og mulighet eies av samme bruker, ellers `error_code`. Tilsvarende avkobling.
- RPC `network_link_posting_contact(...)`: oppretter eller kobler annonsekontakt til `network_contacts` med kilde `job_posting`, kun på eksplisitt id fra klienten.
- RPC `network_start_application_from_posting(...)`: idempotent oppsett/oppdatering av `user_opportunity` på `identity_fingerprint`, returnerer eksisterende id ved gjentatt kall.
- Alle RPC-er er SECURITY DEFINER uten execute for `anon`/`authenticated`, kalt fra serverhandlinger i `src/lib/network.functions.ts` som alltid tar `user_id` fra sesjonen.

**Leselag** (`src/lib/queries/network.ts`): utvidelser for annonsekontakt fra `source_postings.raw_payload.contactList`, koblede dokumenter, arbeidsgiverinnsikt per selskap, og en felles `buildTimeline(graph, scope)`.

**UI:** ny `src/components/network/detail-layout.tsx` (fast arbeidsflate + historikkbevisst tilbake) og `timeline.tsx`; de tre detaljrutene bygges om til panelrutenettene over med eksisterende `NetworkPanel` og `ActivityDialog`.

## Verifikasjon før levering

1. Navigasjon: lenker mellom selskap/kontakt/mulighet/aktivitet/dokument treffer riktig detalj; `← Tilbake` bevarer filter.
2. Mulighet: riktig `Stilling · Selskap`, annonsekontakt øverst til høyre, `Åpne annonse` i paneloverskrift, ingen dublett av dokumentinfo, riktige tomtilstander.
3. Integritet (syntetiske rollback-tester): dokument kan ikke kobles til annen brukers mulighet, annonsekontakt opprettes aldri uten brukerhandling, navnelikhet kobler aldri, gjentatt «start søknad» gir én mulighet, `auto_applied` forblir 0.
4. Visuelt: skjermbilder av alle tre detaljsider på 1440 px og 390 px; ingen horisontal scroll, overskrifter synlige, intern scroll, kollaps til én linje.

Stopp etter 5C med rapport.
