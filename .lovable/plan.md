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

- `employer_reviews` — én aktiv rad per (bruker/gjest, vurderingsobjekt, erfaringsgrunnlag). Felter: `company_id` (påkrevd for publisering), `organisasjonsnummer`, `scope` (`juridisk_enhet | arbeidsgivervirksomhet | konsern`), `experience_basis`, `status` (`draft | submitted | ai_checked | approved | needs_revision | needs_manual_review | rejected | withdrawn`), `submitted_at`, `published_at`.
- `employer_review_dimension_scores` — åtte kanoniske dimensjoner, `score` eller `insufficient_basis` (teller ikke som lav score).
- `employer_review_texts` — fritekst + anonymisert, godkjent utdrag som eget felt.
- `employer_review_moderation` — AI-flagg (personopplysninger, særlige kategorier, identifiserbare personer, alvorlige påstander, injurier, intern info), modell-/regelversjon, manuell beslutning.
- `employer_review_revisions` — append-only revisjonshistorikk.
- `employer_review_guest_controls` — engangsverifisering/rate limit; kontaktopplysning lagres adskilt, aldri i DTO.
- Transaksjonell migrering av eksisterende `user_company_ratings` inn i modellen med proveniens `legacy_user_company_ratings`; gamle rader beholdes read-only.

### Trinn 3 — Aggregering med personvernterskel

- `employer_review_aggregates` (materialisert per company_id × scope × dimensjon) oppdateres av SECURITY DEFINER-RPC ved publisering/tilbaketrekking.
- Terskel: minst fem ulike bidragsytere per dimensjon, objekt og omfang. Under terskel returneres kun «For få vurderinger til å vise en samlet score».
- Søker/intervjuet teller kun i «Rekruttering og retensjon». Kunde/partner holdes i eget spor og blandes ikke inn i medarbeideropplevelse.
- Aggregater leses kun via `get_employer_review_aggregate` — ingen `anon`-grants, ingen klientside-`user_id`.
- Tilbaketrekking fjerner bidraget fra aggregatet i samme transaksjon.

### Trinn 4 — Moderering

- Serverfunksjon kjører AI-sjekk (Lovable AI) ved innsending og skriver kun flagg/kategorier — aldri rå prompt — til `employer_review_moderation`.
- Ingen fritekst publiseres automatisk ved flagg: rutes til `needs_manual_review` eller `needs_revision` tilbake til forfatteren.
- Publisert utdrag er anonymisert, merket «Brukeropplevelse» og vist med grovt tidspunkt, f.eks. «Tidligere ansatt · 2026».

### Trinn 5 — UI

- Meny under Marked, i rekkefølge: Markedsinnsikt, Arbeidsgiveranalyser, **Vurdering av arbeidsgivere** (`/vurdering-av-arbeidsgivere`).
- Ny flate: søk og valg av verifisert juridisk enhet fra registeret, aggregert visning, og innsendingsflyt (erfaringsgrunnlag → åtte dimensjoner med «Ikke nok grunnlag» → fritekst → omfang → bekreftelse). Gjesteflyt med engangsverifisering.
- Arbeidsgiveranalysen får to nye, tydelig adskilte områder: «Felles vektet vurdering» og «Erfaringer fra brukere». KI-score og brukerscore kombineres aldri.
- «Min vurdering» beholdes, men uten forhåndsutfylte sliders; «Din vektede vurdering» viser «Ikke vurdert ennå» til brukeren har lagret.

## Verifikasjon før rapport

- Read-only revisjon av alle analyser vist som Ferdig; rapport med run-status, gyldig rapport ja/nei, kilde til score, og rader med konstruerte verdier.
- Syntetiske rollback-tester: gjesteinnsending, AI-flagg for personopplysninger, tilbakeholdt alvorlig påstand, godkjent anonymisert tekst, terskel 4 vs. 5 bidragsytere, tilbaketrekking, kryssbrukerlesing av rå vurdering og privat notat.
- UI-verifikasjon med reell innlogget økt på desktop og mobil: ingen horisontal overflow, ingen konsollfeil, ingen tomme/falske scorefelt.

## Tolkninger

- «succeeded» implementeres mot eksisterende `completed`-verdi i enum-en, med `cancelled` og `invalid_output` som nye verdier (ingen destruktiv omdøping av historiske rader).
- Gjestekontroll løses med e-post-engangskode + IP-basert rate limit; e-posten lagres hashet og adskilt fra vurderingen.
- `arbeidsgivervirksomhet` og `konsern` bygges i skjema og RPC nå, men kan bare velges når verifisert global identitet finnes; ellers er kun `juridisk_enhet` valgbar.
