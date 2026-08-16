# CV-gjennomgangen: trinnvis, ikke flat kø — teknisk avklaring

Trinnflyten og rekkefølgen fra forrige plan står. Under er svaret på de sju
punktene, og den konkrete datamodellen for koblinger og gjenopptaksversjonering
som skal ligge fast før migrasjonen kjøres.

## 0. Drifttesten (punkt 7)

`src/routes/api/cv/generations.ts` importerer i dag ingen vendor- eller
adaptermodul: den kaller `prepareGenerationStart` fra
`generation/start-service.ts` via dynamisk import, og laster `supabaseAdmin`
inne i handleren. Rettingen ble gjort i forrige runde. Første handling i
implementeringen er likevel å kjøre drifttest, typecheck, bygg og kontraktstest
og rapportere resultatet før noe annet — ingen migrasjon før den er grønn.

## 1. Kanonisk datamodell for brukerlagte elementer

`cv_parse_candidates` brukes **ikke** som lager for brukerredigert
karriereinnhold. Tabellen er parselaget: én rad = maskinens tolkning av én
kildepassasje, med `source_type`/`source_quote`/`parse_confidence` og
`(import_id, local_ref)` som identitet. En brukerlagt rolle har ingen kilde i
importen og ville krevet syntetiske verdier i akkurat de feltene.

Brukerlagte roller og resultater går derfor rett inn i den etablerte
atomflyten som `career_atoms` med `atom_kind='evidens'`, opprettet via samme
server-side godkjenningsvei som promotering, med `source_type='user_input'` og
provenance i `structured_data` (bruker, tidspunkt, `review_import_id`,
`review_step`, original tekst). Ingen ny skriveport, samme idempotens- og
RLS-regler.

`origin` legges **ikke** til på `cv_parse_candidates`. Parsekandidater beholder
sin betydning uendret.

## 2. Koblinger — egen tabell, ikke JSONB

Dagens modell har `career_atoms.parent_atom_id` (én forelder) og
`career_atoms.evidence_atom_ids` (uuid-array). Arrayet kan ikke bære
begrunnelse, hvem som bestemte koblingen, eller historikk, og har ingen
unikhetsregel. Én kompetanse mot flere roller *og* flere resultater med
provenance krever derfor en smal koblingstabell.

`public.career_atom_links`:

| kolonne | innhold |
|---|---|
| `id` | uuid pk |
| `user_id` | eier, alle policyer på `auth.uid()` |
| `from_atom_id` | FK `career_atoms` on delete cascade — kompetansen/eksponeringen |
| `to_atom_id` | FK `career_atoms` on delete cascade — rollen eller resultatet |
| `link_type` | `belegges_av` (kompetanse → rolle/resultat), `oppnadd_i` (resultat → rolle), `avledet_av` (eksponering → rolle) |
| `decided_by` | `machine_suggested`, `user_confirmed`, `user_overridden` |
| `status` | `foreslatt`, `aktiv`, `avvist`, `trenger_ny_vurdering` |
| `confidence` | `hoy`, `lav` — maskinens sikkerhet ved forslag |
| `reasons` | jsonb: signalene bak forslaget |
| `source_candidate_id` | FK `cv_parse_candidates`, null for brukerlagte |
| `superseded_by` | FK til samme tabell — historikk uten sletting |
| `created_at`, `decided_at`, `decided_by_user_id` | |

- Unikhet: `unique (user_id, from_atom_id, to_atom_id, link_type) where superseded_by is null` — hindrer duplikatkoblinger, tillater historiske rader.
- Ingenting slettes: en overstyring setter `superseded_by` på den gamle raden og skriver en ny.
- `evidence_atom_ids` beholdes som avledet speiling for eksisterende lesere, oppdatert fra koblingstabellen av en trigger, slik at generering og matching ikke må endres i denne fasen.
- GRANT select/insert/update til `authenticated`, ALL til `service_role`, ingen `anon`. RLS på `auth.uid() = user_id`.

`suggestion jsonb` på forslagsraden bærer bare forklaringen (confidence,
reasons, maskinens opprinnelige forslag, snapshot ved overstyring). Relasjonen
selv ligger i tabellen over.

## 3. Resultatplassering

Et resultat plasseres under en rolle **kun** når parsen gir en strukturell
kobling: `parent_local_ref` peker på rollekandidaten, eller resultatet lå i
rollens bullet-liste i importen. Ordlikhet mellom resultattekst og rolletittel
plasserer aldri noe.

Uten strukturell kobling får resultatet `trenger_plassering` og vises i trinn 2
i en egen bolk «Hvor hører dette hjemme?», der brukeren velger rolle eller lar
det stå frittstående. `career_atom_links.link_type='oppnadd_i'` opprettes først
når plasseringen er avgjort.

Ny vurdering:
- Endres en rolle (tittel, arbeidsgiver, periode), settes alle aktive lenker inn mot den rollen til `trenger_ny_vurdering`, og trinn 2 og 3 merkes «må vurderes på nytt» i fremdriftslinjen.
- Endres et resultat, settes kompetanselenkene inn mot det resultatet til `trenger_ny_vurdering`.
Ingen lenke fjernes automatisk; brukeren bekrefter eller endrer.

## 4. Konservativ sikkerhet

Signaltyper:
- **Strukturelle**: `parent_local_ref`, bullet-tilhørighet, samme `local_ref`-seksjon, dato-/periodeoverlapp.
- **Eksplisitt kildebaserte**: kompetansenavnet forekommer ordrett i rollens eller resultatets `source_quote`.
- **Tekstlige**: ordoverlapp, normalisert navnelikhet.

Høy sikkerhet krever minst ett strukturelt eller eksplisitt kildebasert signal
**i tillegg til** et tekstsignal. To varianter av samme ordlikhet teller som ett
signal. Kompetansene i dagens import har verken `parent_local_ref`,
kildeposisjon eller tidsdata, så det er forventet at få eller ingen kvalifiserer
til bulk i første versjon. Da vises ingen bulk-knapp, og alle går én og én.

## 5. Gjenopptak og versjonering

`public.cv_review_progress`: `user_id`, `import_id`, `candidate_set_signature`,
`analysis_version`, `current_step`, `step_state` jsonb (status og
`needs_recheck` per trinn), `is_stale`, `stale_reason`, tidsstempler.
Unik på `(user_id, import_id, candidate_set_signature)`.

`candidate_set_signature` er en stabil hash av kandidatsettet for importen
(`local_ref`, `suggested_atom_type`, normalisert tekst, `dedupe_key`) sammen med
analyse-/normaliseringsversjonen fra den kanoniske kontrakten. Ved ny analyse,
regenerering eller vesentlig endring av settet endres signaturen: den gamle
raden markeres `is_stale`, og brukeren får valget «Start gjennomgangen på nytt»
eller «Se hva som er endret». Systemet gjenopptar aldri en progresjon hvis
signatur ikke stemmer med dagens kandidatsett. Allerede bekreftede atomer og
lenker påvirkes ikke — bare fremdriften.

## 6. Privat tidslinjekontekst

`public.cv_review_timeline_context` (user_id, import_id, gap_start, gap_end,
category, note, tidsstempler), RLS på `auth.uid()`, ingen `anon`, ingen
kobling til `career_atoms`.

Tester som må være grønne, ikke bare RLS:
- snapshotbyggeren for CV-generering inneholder ingen felter fra tabellen,
- modellinput og ATS-grunnlag likeså,
- eksportgrunnlaget likeså,
- ingen `select *`-spørring i lesestien treffer tabellen (statisk sjekk på at kun gjennomgangsmodulen refererer tabellnavnet).

## Rekkefølge

1. Drifttest, typecheck, bygg og kontraktstest — rapport før migrasjon.
2. Migrasjon: `career_atom_links`, `cv_review_progress`, `cv_review_timeline_context`, speilingstrigger for `evidence_atom_ids`, GRANT + RLS.
3. Trinn 1: tidslinje, hulldeteksjon, brukerlagte roller gjennom atomflyten.
4. Direkte oppstart etter analyse.
5. Trinn 2 med `trenger_plassering`.
6. Trinn 3 med koblingstabell, begrunnelser og konservativ bulk.
7. Trinn 4, fremdrift/gjenopptak, full testdekning.
