# Fase 4 — Kontrollert promotering av godkjente LinkedIn-forslag

## Preflight: hva som faktisk finnes i dag (verifisert)

- `career_atoms.source_type` er fritekst `NOT NULL` **uten** CHECK-constraint (dagens verdier: `old_cv_pdf`, `user_input`). `linkedin_export` kan derfor tas i bruk additivt uten enum-endring.
- Roller lages som `atom_kind='evidens'`, `atom_type='role'`. Attestasjon er valgfri og settes av databasen; `attestation` skal stå urørt for LinkedIn.
- Kanoniske lenke-RPC-er finnes: `career_atom_link_suggest`, `career_atom_link_decide`, `career_atom_link_override`. `parent_atom_id`/`career_atom_links` skrives ikke direkte.
- **Det finnes ingen `user_preference_atoms`-tabell.** Jobbpreferanser ligger i `user_career_profiles` (ønskede rolletyper, bransjer, lokasjon, remote/travel) og delvis i `profiles`. Promotering av preferanser må derfor gå mot disse feltene, ikke mot en preferansemodell som ikke eksisterer.
- `contacts` er applikasjonsorientert (`application_id`, `email`, `phone`, notater knyttet til søknadsløp). Egnet nettverksmodell mangler → additiv `network_contacts` bygges.
- Det finnes **ingen** modell for tredjepartsanbefalinger (`positioning_recommendations` er noe helt annet) → additiv `career_recommendations` bygges.
- `job_leads` har ingen CHECK-constraints og krever kun `user_id` + `status`; `email_connection_id` er nullbar. Modellen kan derfor bære en kildeuavhengig, brukerlagret jobb, men mangler kildefelt → additive kolonner `source_system`, `source_url_hash`, `source_observed_at`.
- Fase 3-statusmodellen er en CHECK-liste uten `promoted`/`promotion_failed` → utvides additivt.
- Staging har `source_classification` i `('A','B')`, med presis proveniens (`source_file`, `source_row_number`, `source_row_hash`, `source_content_hash`). Klasse B blokkeres i porten; klasse C finnes ikke i staging.
- Formål er begrenset til `profile, career, network, jobs, learning, content`.

Ingen blokkerende avvik funnet. Ett avvik meldes eksplisitt: **jobbpreferanser har ingen atomisk preferansemodell**, så promotering av preferanser begrenses til navngitte, tomme felt i `user_career_profiles` med `use_linkedin_value`/`keep_existing`/`manual_edit_required`.

## Datamodell (additiv)

1. `linkedin_promotion_events` — append-only revisjonsspor med feltene i instruksen (proposal-id, decision-id, domene, action, status, `idempotency_key` unik per bruker, målreferanse, LinkedIn-proveniens, snapshot-hasher før/etter, feilkode). Ingen FK til staging-rader; kun kildeidentitet + hash overlever retention. Slettet produktdata sletter ikke hendelsen (målreferanse er løs, ikke FK-kaskade).
2. `linkedin_promotion_targets` — kobling hendelse → produktmål. Egen `user_id`, sammensatt FK `(promotion_event_id, user_id)` mot `linkedin_promotion_events`, CHECK på tillatte `entity_type`-verdier, unikhet på `(promotion_event_id, entity_type, entity_id)`, RLS `auth.uid() = user_id`. `entity_id` er ren revisjonsreferanse — ingen FK til staging, og aldri en vei inn i en annen brukers produktdata (all lesing filtreres på `user_id`).
3. `career_recommendations` — tredjepartsanbefalinger, `source_classification='third_party_recommendation'`, aldri attestasjon, aldri synlig for CV-/søknadsgenerering.
4. `network_contacts` (+ `network_contact_identities` for LinkedIn-URL som foretrukket identitet). Ingen e-post/telefon fra LinkedIn. Ingen relasjonsklassifisering.
5. `career_skill_source_signals` — endorsement-antall og kilde som tredjepartssignal knyttet til et kompetanseatom; aldri nivå, aldri bevisstatus.
6. Additive kolonner: `job_leads.source_system/source_url_hash/source_observed_at`; utvidet statusliste på `linkedin_reconciliation_proposals`.

Alle nye tabeller: `GRANT SELECT` til `authenticated`, `GRANT ALL` til `service_role`, ingen `anon`, RLS på med `auth.uid() = user_id` for lesing. Ingen klientskriving.

## Promoteringsport (RPC-er)

`SECURITY DEFINER`, `search_path=''`, fullt kvalifiserte referanser:

`linkedin_promote_profile_field`, `linkedin_promote_career_record`, `linkedin_promote_qualification`, `linkedin_promote_skill_or_signal`, `linkedin_promote_recommendation`, `linkedin_promote_network_contact`, `linkedin_promote_job_preference`, `linkedin_promote_saved_job`.

Felles forport (delt intern funksjon) i én transaksjon:
auth.uid() → eierskap på forslag+beslutning → `approved_for_promotion` → aktiv import og ikke `stale_*`/`superseded`/`dismissed` → formål dekker domenet → klasse A → reles gjeldende mål og sammenlign mot `target_snapshot_hash` (avvik ⇒ `stale_target` + konflikt-DTO) → domeneoperasjon → hendelse → `status='promoted'`. Feil ⇒ rollback + `promotion_failed`-hendelse, ingen delvis effekt.

`resolution` er påkrevd: `create_new | link_to_existing | use_linkedin_value | keep_existing | manual_edit_required`. Ingen `replace_existing`.

En TanStack-serverrute `POST /api/linkedin/promote` velger riktig RPC ut fra forslagstype og returnerer sanitert DTO.

## Domeneregler (kort)

- **Profil**: kun headline, summary, location, industry, public_profile_url, languages. Tomt felt ⇒ opprett; ulik verdi krever `use_linkedin_value`; manuelt redigert overskrives aldri. Ett felt per operasjon.
- **Karriere**: nytt rolleatom med `source_type='linkedin_export'` og maskinlesbar `source_ref`. Parallelle roller forblir separate. Dublett/konflikt kun `link_to_existing` (uendret mål), `create_new` eller `manual_edit_required`. Lenker via kanoniske link-RPC-er. Aldri `cv_claim_attestations`.
- **Kvalifikasjoner/utdanning/sertifisering/språk**: egne atomer med korrekt `atom_type`, bevart utsteder/dato/credential-id. Fortsatt selvoppgitt.
- **Kompetanse/endorsements**: kompetanse som `self_reported_linkedin`; endorsements kun som signalrad. Ingen duplikate kompetanseatomer.
- **Anbefalinger**: `career_recommendations`, dedupe på (forfatteridentitet, teksthash).
- **Nettverk**: `network_contacts`, LinkedIn-URL som identitet, navnelikhet slår aldri sammen, aldri i `contacts`.
- **Jobber**: preferanse kun mot tomme/eksplisitt valgte felt i `user_career_profiles`; lagret jobb ⇒ `job_leads` uten søknad/mulighet.
- **Innhold/artikler**: returner `not_actionable_in_phase_4`; forslaget forblir godkjent, upromotert.

## Minimal UI

`/kildegjennomgang` beholdes. På forslag med status `approved_for_promotion` vises én domenespesifikk knapp («Legg til i min profil», «…i karriereoversikt», «…i nettverket», «…som kvalifikasjon», «…som LinkedIn-anbefaling») som åpner en liten bekreftelsesdialog: hva opprettes/kobles, valg av resolution ved konflikt, hva som ikke endres, kildeklassifisering, og knappen «Bekreft og legg til». Statusene `promoted`, `promotion_failed`, `stale_source`, `stale_target` vises tydelig, med lenke til promotert mål. Ingen promotering ved «Godkjenn for senere bruk».

## Verifikasjon

Utvider canary-mønsteret fra Fase 3 (`scripts/canary/linkedin-promotion-phase4-tests.sql`): syntetiske data, full rollback, ingen bruk av reell eksport. Dekker alle 26 portene i instruksen — idempotens (dobbeltklikk, dublett-URL, dublett-anbefaling), stale-tilstander, klasse B/uvalgt formål blokkert, kryssbruker blokkert, atomisitet, sletting av import berører ikke promoterte data, og før/etter-tellinger per produktområde.

## Leveranse

Migrasjoner + modelloversikt, RPC-/domeneoversikt, RLS- og grant-rapport, oppdatert `docs/linkedin-import-contract-v1.md` med proveniens- og retention-regler for promoterte data, testmatrise med resultater, før/etter-tellinger og konkrete promoteringseksempler. Stopp før Fase 5.
