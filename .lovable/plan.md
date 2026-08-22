# Fase 5B — Nettverksarbeid som egen hovedmodul

Bygger videre på 5A. Produktkontrakt v1.1 er normativ. Ingen automatisk LinkedIn-promotering, ingen mock-data, ingen KI-tjeneste i denne leveransen.

## 1. Hovedmeny og ruter

`src/components/app-sidebar.tsx`:
- Fjern `Nettverk og muligheter` fra undermenyen til `Min karriere`, og fjern `/nettverk` fra dens match-prefikser.
- Ny toppnivågruppe `Nettverksarbeid` (ikon `Network`) plassert etter `Min karriere` og før `Marked`, match-prefiks `/nettverk`, med fem sekundærpunkter i rekkefølgen Oversikt, Selskaper, Kontakter, Muligheter, Aktiviteter. Hovedpunktet peker på `/nettverk/oversikt`.
- `/nettverk` redirecter til `/nettverk/oversikt` (endres i `nettverk.index.tsx`).
- Titler/metadata i `nettverk.tsx` og `NetworkShell` endres til «Nettverksarbeid». Eksisterende dypelenker (`/nettverk/kontakter/$id`, `/nettverk/selskaper/$id`) er uendret.

Nye ruter:
- `nettverk.oversikt.tsx`
- `nettverk.muligheter.index.tsx`, `nettverk.muligheter.$id.tsx`
- `nettverk.aktiviteter.index.tsx` (med inline-detalj/kompakt redigering; ingen modal-detalj)

## 2. Felles layout

`NetworkShell` utvides til fem faner. Globalt søk beholdes og utvides til å lenke til mulighetsdetalj. Alle lister/tellinger bruker det eksisterende paginerte leselaget (`fetchAllPages`) — ingen 1 000-rads grense. Desktop: fast høyde under toppnav, interne scrollflater, kollapsbare paneler (`NetworkPanel` får kollapsstøtte via eksisterende `use-persisted-collapse`). Mobil: én kolonne, ingen horisontal scroll. Detaljsider er egne ruter med kun `← Tilbake` (eksisterende `BackLink`).

## 3. Oversikt

Statuskort (alle lenker til filtrert liste):
- Trenger oppfølging → åpne/forfalte aktiviteter.
- Aktive muligheter → ikke-avsluttede `user_opportunities`.
- Varme kontakter → smal definisjon: kontakt med fullført aktivitet siste 90 dager der aktiviteten er knyttet til kontakten og `activity_type` er `moete`, `samtale` eller `e_post`. Fullført søknadsoppgave gjør ikke en kontakt varm. Uten grunnlag skjules kortet.
- Intervjuer denne måneden → verifisert: `interviews` er bruker-scopet med RLS på `auth.uid()` og har `scheduled_at`, så kortet bygges på den tabellen, supplert med `next_steps` der `activity_type = 'intervju'` og `status <> 'avlyst'`.


Innhold: neste aktiviteter (dato først, tekst på samme linje), prioriterte selskaper kun der `status`/`priority` er lagret på `user_company_relationships`, siste aktivitet kun innenfor nylig periode (90 dager), hurtighandlinger `Logg aktivitet`, `Ny mulighet`, `Åpne aktiviteter`. `Få aktivitetsforslag` vises deaktivert med `Kommer snart` — ingen kall, ingen lagring.

## 4. Selskaper

Utvides på eksisterende flate: bransje/sted når kjent, antall kontakter, åpne muligheter, status/prioritet kun når satt, merket `Relatert via kontakt` når selskapet kun er observert via kontakt. `Company Follows` forblir signal og oppretter ingenting.

Detalj: registerprofil og arbeidsgiveranalyse når data finnes (ellers eksplisitt datamangelstilstand med kilde/tidspunkt-regler fra kontrakten), dine kontakter, aktive muligheter, åpne aktiviteter og neste aktivitet med dato + handling, lenker til kontakt/mulighet/aktivitet. Paneler med fast overskrift, kollaps og intern scroll.

## 5. Kontakter

Beholder 5A-import og precedence (manuell verdi aktiv, LinkedIn-observasjon sekundært med tidspunkt). Legger til lenkbare relasjoner: navn → kontakt, selskap → selskap, kontaktens aktiviteter og muligheter som lenker. Ingen e-post/telefon fra LinkedIn, ingen endorsement-personer, ingen automatisk kobling av mottatte anbefalinger.

## 6. Muligheter

Liste over reelle `user_opportunities`: stilling, selskap, status, neste aktivitet og matchdata når beregnet. Merk: tabellen har ingen egen søknadsfrist-kolonne, så «frist» vises som neste aktivitets `due_date` når den finnes; ingen fiktiv frist.

Detalj: stilling først, deretter selskap; lenke til original annonse når `card_display_url`/`card_raw_url` finnes; preferanse- og kompetansematch separat, med `match_score_version`/`match_scored_model` og `screening_evaluated_at` som sekundær informasjon; annonsekontakt (`job_posting`) vises høyt kun når personen faktisk finnes i annonsegrunnlaget, og opprettes som kontakt kun via eksplisitt brukerhandling (aldri navnesammenslåing); «Dine kontakter i selskapet» kun reelle relasjoner med god tomtilstand; «Dokumenter brukt» kun ved faktisk relasjon til muligheten.

## 7. Aktiviteter

### Migrasjon (additiv)
- `next_steps.activity_type` (tekst-enum: `oppfolging`, `moete`, `samtale`, `e_post`, `soknad`, `intervju`, `annet`; default `annet`).
- `next_steps.status` (`planlagt`, `pagaar`, `utfort`, `avlyst`; default `planlagt`).
- `next_steps.result_note` (tekst, nullbar).
- Backfill: `completed = true` → `status = 'utfort'`, øvrige `planlagt`. `completed`/`completed_at` beholdes og holdes i synk med `status` via trigger.
- `user_id` NOT NULL sikres; `application_id` forblir valgfri; kontakt-/mulighets-/søknadskoblinger bruker sammensatte user-scopede FK-er slik at kryssbrukerkobling avvises i databasen.
- Indekser på `(user_id, status, due_date)`, `(user_id, contact_id)`, `(user_id, opportunity_id)`, `(user_id, company_id)`.
- RLS beholdes; nye RPC-er `network_upsert_activity` og `network_complete_activity` (SECURITY DEFINER, EXECUTE kun `service_role`), kalt fra nye serverfunksjoner i `src/lib/network.functions.ts`. Klienten sender aldri `user_id`.

### Funksjon
Filtre: åpen/utført, prioritet, type, forfalt/kommende, selskap, kontakt, mulighet. Aktivitet kan opprettes fra Oversikt, selskap, kontakt og mulighet; få frist; åpnes for logging; markeres utført fra detalj eller sirkelen i listen; lagrer utførelsesdato og `result_note`.

## 8. Sikkerhet

Ingen automatisk promotering eller overskriving av manuelle verdier. All skriving via kanoniske serverhandlinger. `source_class` brukes konsekvent (`user_input`, `linkedin_observation`, `job_posting`, `derived_evaluation`, `ai_suggestion`). LinkedIn-data merkes aldri `documented`/`verified`/`user_attested`.

## 9. Verifikasjon før levering

- Meny: `Nettverksarbeid` mellom `Min karriere` og `Marked`, fem punkter i rekkefølge, `/nettverk` → Oversikt.
- Funksjon: alle fem flater åpnes; søk lenker til korrekt kontakt-, selskaps- og mulighetsdetalj; aktivitet opprettes, fullføres og viser dato/resultat; syntetisk test bekrefter at kryssbrukerkobling blokkeres i databasen.
- UI: skjermbilder på 1440 px og 390 px, ingen horisontal overflow eller overlapp, faste paneloverskrifter, intern scroll, kollaps fungerer.
- Integritet: før/etter-telling for `network_contacts`, identiteter, selskapsrelasjoner, muligheter, aktiviteter og LinkedIn-promoteringshendelser, med bekreftelse på at ingenting er promotert automatisk.

Leveransen stopper etter 5B med rapport. KI-tjeneste, e-postintegrasjon og ny LinkedIn-import/cron er utenfor scope.
