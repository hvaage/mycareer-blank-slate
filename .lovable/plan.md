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
| `from_atom_id` | FK `career_atoms` **on delete restrict** — kompetansen/eksponeringen/resultatet |
| `to_atom_id` | FK `career_atoms` **on delete restrict** — rollen eller resultatet |
| `link_type` | `belegges_av` (kompetanse → rolle/resultat), `oppnadd_i` (resultat → rolle), `avledet_av` (eksponering → rolle) |
| `decided_by` | `machine_suggested`, `user_confirmed`, `user_overridden` |
| `status` | `foreslatt`, `aktiv`, `avvist`, `trenger_ny_vurdering` |
| `confidence` | `hoy`, `lav` — maskinens sikkerhet ved forslag |
| `reasons` | jsonb: signalene bak forslaget |
| `review_import_id` | FK `cv_imports` **not null** — importen/gjennomgangen der lenken ble foreslått eller avgjort; settes også når `source_candidate_id` er null |
| `source_candidate_id` | FK `cv_parse_candidates`, null for brukerlagte |
| `supersedes_link_id` | FK til samme tabell — den nye lenken peker tilbake på den den erstatter |
| `superseded_at`, `superseded_reason` | settes på den *gamle* lenken når den erstattes |
| `created_at`, `decided_at`, `decided_by_user_id` | |

- Unikhet: `unique (user_id, from_atom_id, to_atom_id, link_type) where superseded_at is null` — hindrer duplikatkoblinger uten å binde unikheten til en FK som peker fremover i tid.
- Overstyring skjer atomisk i én RPC: gammel rad får `superseded_at`/`superseded_reason`, ny rad settes inn med `supersedes_link_id` mot den gamle. Ingenting slettes.
- Sletting: `on delete restrict` på begge FK-ene. Fjerner brukeren et atom fra visningen, skjer det som kontrollert arkivering (`career_atoms.is_active = false` via eksisterende `career_atom_delete`-flyt), ikke som rad-sletting. Koblingshistorikken blir stående.
- Skrivetilgang: `GRANT SELECT` til `authenticated` (RLS `auth.uid() = user_id`), `GRANT ALL` til `service_role`, ingen `anon`, **ingen INSERT/UPDATE/DELETE til `authenticated`**. All opprettelse, bekreftelse, avvisning, overstyring og merking for ny vurdering går gjennom `security definer`-RPC-er (`career_atom_link_suggest`, `_confirm`, `_reject`, `_override`, `_mark_recheck`) som verifiserer `auth.uid()` og eierskap på begge atomene.

### Databaseinvarianter (trigger, håndheves også mot service role)

Avvises: lenke mellom atomer med ulik `user_id`; lenke der `user_id` ikke matcher
atomenes eier; `from_atom_id = to_atom_id`; ugyldig kombinasjon av `atom_type`/
`atom_class` og `link_type` (f.eks. `belegges_av` fra noe som ikke er kompetanse,
eller mot noe som ikke er rolle/resultat/kvalifikasjon); `supersedes_link_id` som
peker på en lenke med annet atompar, annen `link_type` eller annen eier;
supersedering av en allerede supersedert lenke; og sirkulær supersederingskjede
(rekursiv sjekk). Vaktene ligger i triggere, ikke i RLS, slik at de også gjelder
`service_role` — testene kjøres både som innlogget bruker og som service role.
Vakten validerer i tillegg: `review_import_id` eies av samme `user_id`;
`source_candidate_id`, når den er satt, har samme `user_id`, tilhører
`review_import_id` og har ikke status `avvist` (eller er på annen måte ugyldig
som kilde); og `status='aktiv'` avvises dersom `from_atom_id` eller `to_atom_id`
er arkivert (`is_active=false`).

### Security definer-regler for alle nye RPC-er

Alle lenke- og progresjons-RPC-er: `security definer`, `set search_path = ''`
med fullt kvalifiserte objektnavn (`public.`, `auth.`), `revoke execute on
function ... from public, anon`, `grant execute ... to authenticated` bare der
brukerflyten trenger det, og eksplisitt `auth.uid()`- og eierskapskontroll inne i
funksjonen — aldri bare RLS.



`suggestion jsonb` på forslagsraden bærer bare forklaringen (confidence,
reasons, maskinens opprinnelige forslag, snapshot ved overstyring). Relasjonen
selv ligger i tabellen over.

### `career_atoms.evidence_atom_ids` — kompatibilitetsprojeksjon, ingen generell trigger

Én beslutning: `career_atom_links` er den kanoniske relasjonen, og
`evidence_atom_ids` er en kompatibilitetsprojeksjon som holdes i synk.

- **Innhold i dag**: `uuid[] not null default '{}'`, pekere fra en indirekte klasse (kompetanse/eksponering) til atomene som belegger den. I databasen nå: 9 atomer (5 roller, 1 resultat, 3 kvalifikasjoner), **null referanser totalt** og null `parent_atom_id`. Feltet leses av `dashboard-status.ts`, `career-atoms.ts`, `career_atom_delete_impact`/`career_atom_delete` og av CHECK-regelen «kompetanse med `confidence='verified'` krever minst én oppføring».
- **Hva som projiseres**: kun `belegges_av` og `avledet_av` med `status='aktiv'` og `superseded_at is null`. `oppnadd_i` projiseres aldri — den hører til `parent_atom_id`-aksen.
- **Sporbarhet**: `evidence_atom_ids` kan ikke selv fortelle hvilke UUID-er som stammer fra lenketabellen. Derfor føres eierskapet i en smal intern tabell `public.career_atom_evidence_projection` (`user_id`, `atom_id`, `referenced_atom_id`, `link_id` FK `career_atom_links`, `created_at`, unik på `(atom_id, referenced_atom_id, link_id)`). Ingen `authenticated`-skriv; kun projeksjonsfunksjonen skriver.
- **Hvordan**: projeksjonen oppdateres atomisk i samme transaksjon som lenkeendringen, gjennom én felles funksjon `public.career_atom_project_evidence(atom_id)` som alle relevante skriveflyter bruker. Den legger til og fjerner kun de referansene projeksjonstabellen eier for det atomet, bevarer historiske og andre eksplisitte evidensreferanser, og skriver aldri hele arrayet blindt. Ingen generell trigger.
- **Backfill**: ingen. Det finnes ingen eksisterende arrays å migrere.
- **Arkivering**: når `career_atom_delete` arkiverer et atom, beholdes alle lenker historisk, aktive lenker til eller fra atomet settes til `trenger_ny_vurdering`, og projeksjonen oppdateres atomisk i samme transaksjon. `career_atom_delete_impact` rapporterer antall berørte aktive lenker og hvilke atomer som mister sitt siste belegg.
- **Tester**: arkivering med (a) aktiv `belegges_av`-lenke, (b) aktiv `oppnadd_i`-lenke, (c) supersedert lenke. Skal vise at atomet arkiveres, at `on delete restrict` ikke gir feil, at lenkehistorikken står, at aktive lenker er merket for ny vurdering, og at lenketabell, projeksjonstabell og `evidence_atom_ids` ikke motsier hverandre etterpå. Delete-impact verifiseres mot samme oppsett.




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
`needs_recheck` per trinn), `is_stale`, `stale_reason`, `superseded_at`,
tidsstempler.

- Unik på `(user_id, import_id, candidate_set_signature)`.
- Partial unique `(user_id, import_id) where is_stale = false` — maksimalt én aktiv, ikke-foreldet rad per bruker og import.

`candidate_set_signature` bygges deterministisk av, per kandidat, sortert på
kandidat-id: `id`, `local_ref`, kanonisk innholds-/kildehash (normalisert
`content_no`/`content_en` + `source_type` + `source_ref` + `source_quote`),
`suggested_atom_type`, `dedupe_key`, `parent_local_ref` og de relevante feltene i
`structured_data` (for roller: `employer_normalized`, `title`, `start_date`,
`end_date`; for kompetanse: `name_normalized`, `source_category`). Til slutt
hashes settet sammen med analyse-/normaliseringsversjonen fra den kanoniske
kontrakten. Normalisert tekst alene brukes ikke.

Skrivetilgang: `authenticated` får kun `SELECT` på egen rad (RLS `auth.uid()`).
`current_step`, `step_state` og `is_stale` oppdateres bare gjennom
`cv_review_progress_advance` (`security definer`), som verifiserer eierskap,
sammenligner `candidate_set_signature` med dagens kandidatsett, nekter
oppdatering av en foreldet rad, håndhever trinnrekkefølgen og tar
`select ... for update` på den aktive raden slik at parallelle oppdateringer
serialiseres.

Endres signaturen, skjer overgangen atomisk i én server-side RPC: gammel rad får

`is_stale = true`, `stale_reason` og `superseded_at`, og den nye raden opprettes i
samme transaksjon. Brukeren får «Start gjennomgangen på nytt» eller «Se hva som er
endret». Systemet gjenopptar aldri en progresjon hvis signaturen ikke stemmer med
dagens kandidatsett. Allerede bekreftede atomer og lenker påvirkes ikke — bare
fremdriften.


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
2. Migrasjon: `career_atom_links` med invariantvakter, kontrollerte lenke-RPC-er (som også vedlikeholder projeksjonen til `evidence_atom_ids`), oppdatert `career_atom_delete`/`career_atom_delete_impact`, `cv_review_progress` med progress-RPC, `cv_review_timeline_context`, GRANT + RLS. Ingen generell speilingstrigger.
3. Trinn 1: tidslinje, hulldeteksjon, brukerlagte roller gjennom atomflyten.
4. Direkte oppstart etter analyse.
5. Trinn 2 med `trenger_plassering`.
6. Trinn 3 med koblingstabell, begrunnelser og konservativ bulk.
7. Trinn 4, fremdrift/gjenopptak, full testdekning.
