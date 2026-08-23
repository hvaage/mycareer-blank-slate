# Fase 5I — Troverdig arbeidsgivervurdering og felles, avgrenset aggregering

Bygger videre på eksisterende Arbeidsgiveranalyse (Marked → Arbeidsgiveranalyser). Ingen parallell vurderingsmodell: `user_company_ratings` utvides/migreres til den kanoniske vurderingsmodellen med proveniens.

## Funn fra forhåndsrevisjonen (bekreftet nå)

- OLIVIA AS AVD STRANDEN (`5461787a…`): jobbstatus `completed`, `employer_analysis_v2` finnes, `ai_overall_score = 4.1`, men `organisasjonsnummer` er NULL. Analysen ble altså kjørt og vist som Ferdig uten verifisert selskapsidentitet, mens detaljsiden samtidig sier «Mangler organisasjonsnummer». `agg_rating_count` er NULL.
- Frontend-standardverdi bekreftet: `src/routes/_authenticated/employers/$companyId.tsx` setter alle dimensjoner til `3` når brukeren ikke har vurdert (linje ~146) og ved manglende enkeltverdi (linje ~135). Dette er kilden til «3.0 / 5».
- Jobbstatus i dag er kun `queued | processing | completed | failed | rate_limited` (`employer_analysis_job_status`). Tilstandene `cancelled` og `invalid_output` finnes ikke, og «Ferdig» settes uten å kreve gyldig rapport.
- Dagens vurdering har bare 6 dimensjoner, ingen erfaringsgrunnlag ut over tre boolske flagg, ingen moderering, ingen omfang og ingen terskel.

## Leveranse i fem trinn

### Trinn 1 — Analyseintegritet (retting av eksisterende flate)

- Utvid jobbstatus med `cancelled` og `invalid_output`; innfør serverside-validering av analyseoutput.
- Nye, eksplisitte felt: `output_validation_status` og `output_validated_at`. De settes kun etter serverside-validering av rapportinnhold, analyseversjon, analysetidspunkt og verifisert organisasjonsnummer. Semantikken til `employer_analysis_rated_at` verifiseres først, og feltet brukes kun som visningsdato dersom det faktisk betyr analysetidspunkt.
- «Ferdig» krever terminal suksess-status + `output_validation_status = 'valid'`. Brukervurderinger er aldri en forutsetning for at en KI-/registeranalyse regnes som vellykket.
- Ved ikke-validert output: ingen badge, ingen AI-score, ingen match, ingen dimensjonsscore — verken i liste eller detalj.
- Eldre vellykket analyse + nyere feilet forsøk vises adskilt: «Siste analyse: <dato>» pluss egen linje «Seneste forsøk feilet».
- Fjern alle frontend-fallbacks (3, 4.1, 1.0) — `EmployerListScore` og detaljsiden viser «Ikke vurdert» / «Ikke nok data».
- Rett OLIVIA-tilfellet: analyser uten verifisert orgnr får `output_validation_status = 'invalid'` og vises ikke som ferdig; start-knappen krever valgt registerenhet (samme dialog som i Muligheter).

### Trinn 2 — Kanonisk vurderingsmodell (migrering, ikke kopi)

Nye/utvidede tabeller i `public`, alle med GRANT → RLS → policy:

- `employer_review_targets` — globalt, verifisert vurderingsobjekt med egen `id`. `target_kind`: `juridisk_enhet` (verifisert `company_id`/orgnr), `arbeidsgivervirksomhet` (verifisert underenhet eller annen autoritativ arbeidsstedsidentitet, med `parent_target_id` til juridisk enhet), `konsern` (kun kontrollert global konsernidentitet).
  - Kanonisk unikhet via partielle unike indekser på aktive objekter (`superseded_at IS NULL`): én aktiv `juridisk_enhet` per verifisert `company_id`, én aktiv `arbeidsgivervirksomhet` per verifisert underenhetsidentitet, én aktiv `konsern` per kontrollert global konsernidentitet. `superseded_at` beholdes for historikk.
  - Objekter opprettes og endres kun av kontrollert serverlogikk (SECURITY DEFINER). Verken bruker eller gjest har INSERT/UPDATE — aldri fra fri tekst eller LinkedIn-navn.
- `employer_reviews` — peker på `review_target_id` (ikke bare `company_id`). Felter: `review_target_id`, `user_id` eller `guest_control_id`, `experience_basis`, `experience_cohort`, `numeric_contribution_status` (`draft | eligible_for_aggregate | withdrawn | rejected`), `submitted_at`.
  - `experience_cohort` utledes deterministisk på serveren fra `experience_basis`: `employee_experience` (`current_employee`, `former_employee`, `contractor`), `candidate_experience` (`applicant`, `interviewed`), `external_relationship` (`customer`, `partner`), `not_eligible` (`other` eller ukjent grunnlag). Kohorten settes aldri av klienten.
  - Vurderinger i `not_eligible` kan lagres som private utkast, men kan aldri få `numeric_contribution_status = 'eligible_for_aggregate'` (håndhevet i RPC og CHECK).
  - CHECK: nøyaktig én forfatteridentitet — `CHECK ((user_id IS NOT NULL) <> (guest_control_id IS NOT NULL))`.
  - Partielle unike indekser for aktive vurderinger: (`user_id`, `review_target_id`, `experience_basis`) og (`guest_control_id`, `review_target_id`, `experience_basis`). Revisjon erstatter den aktive vurderingen — den skaper aldri et ekstra aggregatbidrag.
  - Både OTP-verifisert gjest og innlogget bruker kan lagre en vurdering, men `eligible_for_aggregate` settes først etter serverside kontroll av rate-limit, duplikatvern og integritetsregler. Klienten kan aldri sette statusen.
- `employer_review_dimension_scores` — åtte kanoniske dimensjoner. CHECK håndhever nøyaktig ett av: `score` heltall 1–5, eller `insufficient_basis = true`; både eller ingen avvises. `insufficient_basis` teller ikke som lav score. Endring, tilbaketrekking og modereringsavvisning oppdaterer berørt kohortaggregat i samme transaksjon.
- `employer_review_texts` — fritekst, anonymisert utdrag og **egen** publiseringsstatus: `draft | submitted | ai_checked | needs_manual_review | approved | needs_revision | rejected | withdrawn`. Tekststatus påvirker aldri `numeric_contribution_status`, og godkjent numerisk bidrag gjør aldri fritekst synlig.
- `employer_review_moderation` — AI-flagg (personopplysninger, særlige kategorier, identifiserbare personer, alvorlige påstander, injurier, intern info), modell-/regelversjon, manuell beslutning og beslutningstaker.
- `employer_review_revisions` — append-only revisjonshistorikk.
- `employer_review_guest_controls` — engangsverifisering og rate limit. E-post lagres som keyed HMAC (server-hemmelighet), aldri usaltet hash; rå IP lagres aldri permanent, kun HMAC med kort retensjon; rate-limit-rader slettes automatisk. Ingen kontrollopplysning i noen DTO.
- Transaksjonell migrering av `user_company_ratings` med proveniens `legacy_user_company_ratings`: kun faktisk lagrede svar flyttes. De to dimensjonene som mangler i gammel modell (og alle NULL-verdier) blir `insufficient_basis` — aldri 3.0 eller annen standardverdi. Gamle rader beholdes read-only.

### Trinn 3 — Aggregering med personvernterskel

- `employer_review_aggregates` grupperes på `review_target_id` × `experience_cohort` × dimensjon (aldri company_id × scope, og aldri kun target × dimensjon), og oppdateres av SECURITY DEFINER-RPC. Kun numeriske svar med `numeric_contribution_status = 'eligible_for_aggregate'`, verifisert forfatteridentitet og verifisert `review_target_id` teller. Avdeling, selskap og konsern kan ikke blandes.
- Terskel: minst fem ulike kvalifiserte bidragsytere per kohort, vurderingsobjekt og dimensjon. Under terskel returneres kun «For få vurderinger til å vise en samlet score».
- «Felles vektet vurdering» vises kun når terskelen er oppfylt i den valgte kohorten, og grunnlaget (kohort, antall bidragsytere, dimensjoner) vises tydelig. Er terskelen kun oppfylt for enkelte dimensjoner, vises kun disse dimensjonene — ingen totalvurdering.
- Visning: «Felles vurdering» i Arbeidsgiveranalysen viser som standard `employee_experience`. `candidate_experience` vises separat som «Erfaringer fra søknadsprosessen» og kan kun inneholde «Rekruttering og retensjon». `external_relationship` vises i eget spor og blandes aldri med arbeidsplassvurderinger. `not_eligible` vises aldri offentlig.
- Aggregater leses kun via `get_employer_review_aggregate` (kohort som parameter) — ingen `anon`-grants, ingen klientside-`user_id`.
- Tilbaketrekking fjerner bidraget fra riktig kohortaggregat i samme transaksjon.

### Trinn 4 — Moderering

- Serverfunksjon kjører AI-sjekk (Lovable AI) ved innsending og skriver kun flagg/kategorier — aldri rå prompt — til `employer_review_moderation`.
- Fast tekststatusflyt i 5I: `draft → submitted → ai_checked → needs_manual_review → approved | needs_revision | rejected | withdrawn`. Fritekst publiseres aldri fordi AI-sjekken ikke fant flagg; alt offentlig tekstutdrag krever eksplisitt manuell godkjenning.
- Tekstmoderering er helt adskilt fra numerisk bidrag: en vurdering med tekst i `needs_manual_review` kan fortsatt ha `numeric_contribution_status = 'eligible_for_aggregate'` og telle i aggregatet.
- Det bygges en enkel administrativ modereringskø (admin-rolle). Blir køen ikke ferdig i denne leveransen, holdes «Erfaringer fra brukere» skjult.
- Publisert utdrag er anonymisert, merket «Brukeropplevelse» og vist med grovt tidspunkt, f.eks. «Tidligere ansatt · 2026».

### Trinn 5 — UI

- Meny under Marked, i rekkefølge: Markedsinnsikt, Arbeidsgiveranalyser, **Vurdering av arbeidsgivere** (`/vurdering-av-arbeidsgivere`).
- Ny flate: søk og valg av verifisert vurderingsobjekt (juridisk enhet nå; underenhet/konsern kun når verifisert objekt finnes), aggregert visning, og innsendingsflyt (erfaringsgrunnlag → åtte dimensjoner med «Ikke nok grunnlag» → fritekst → objekt → bekreftelse). Gjesteflyt med engangsverifisering og tydelig personverninformasjon vist før innsending.
- Arbeidsgiveranalysen får to nye, tydelig adskilte områder: «Felles vektet vurdering» og «Erfaringer fra brukere». KI-score og brukerscore kombineres aldri.
- «Min vurdering» beholdes, men uten forhåndsutfylte sliders; «Din vektede vurdering» viser «Ikke vurdert ennå» til brukeren har lagret.

## Verifikasjon før rapport

- Read-only revisjon av alle analyser vist som Ferdig; rapport med run-status, gyldig rapport ja/nei, kilde til score, og rader med konstruerte verdier.
- Syntetiske rollback-tester: gjesteinnsending, CHECK på nøyaktig én forfatteridentitet, AI-flagg for personopplysninger, tilbakeholdt alvorlig påstand, tekst som krever manuell godkjenning før visning, terskel 4 vs. 5 bidragsytere, tilbaketrekking, aggregat som ikke blander avdeling/selskap/konsern, kryssbrukerlesing av rå vurdering og privat notat.
- UI-verifikasjon med reell innlogget økt på desktop og mobil: ingen horisontal overflow, ingen konsollfeil, ingen tomme/falske scorefelt.

## Tolkninger

- «succeeded» implementeres mot eksisterende `completed`-verdi i enum-en, med `cancelled` og `invalid_output` som nye verdier (ingen destruktiv omdøping av historiske rader).
- Gjestekontroll løses med e-post-engangskode og rate limit; både e-post og IP lagres kun som keyed HMAC med kort retensjon, adskilt fra vurderingen.
- `arbeidsgivervirksomhet` og `konsern` bygges i skjema og RPC nå, men kan bare velges når et verifisert `employer_review_target` finnes; ellers er kun `juridisk_enhet` valgbar.
