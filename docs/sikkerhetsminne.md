# Sikkerhetsminne

Denne filen er den versjonerte kopien av prosjektets sikkerhetsminne. Innholdet her og innholdet i byggeverktøyets sikkerhetsminne skal til enhver tid være identisk. Hver gang sikkerhetsminnet oppdateres, skal samme endring committes til denne filen i samme migrasjon eller PR.

Sist oppdatert: 2026-08-24.

## Appen og tilgangsmodellen

Karriereplattform (norsk, bokmål) for jobbsøkere. All brukerdata er personlig og eies av én bruker.

- Autentisering via Lovable Cloud (Supabase Auth). Ingen anonyme innlogginger.
- Alle brukertabeller har RLS med `auth.uid()`-basert eierskap og eksplisitte GRANT-er til `authenticated`.
- Roller ligger i egen tabell (`user_roles`) og sjekkes via SECURITY DEFINER-funksjonen `has_role`. Roller lagres aldri på profil- eller brukertabell.
- Skriveoperasjoner som krever kryssrad-logikk går gjennom SECURITY DEFINER-RPC-er som selv utleder bruker fra `auth.uid()`.
- Registerdata (Brønnøysund/enheter, regnskap) og speilet av jobbannonser er felles referansedata, ikke brukerdata.
- Interne jobber (kø, speiling, batch-import, KI-pipeline) kjøres av `service_role`/`postgres` via cron eller serverfunksjoner, aldri fra klienten.

## Dette skal aldri skje

- En bruker skal aldri kunne lese, endre eller slette en annen brukers CV-data, evidensatomer, nettverksobjekter, jobb-leads, e-postkilder eller vurderinger.
- `anon` skal aldri kunne skrive til noen tabell, og aldri kalle interne drifts- eller køfunksjoner.
- Klientkode skal aldri bruke service role-nøkkel, og nøkkelen skal aldri logges, returneres eller eksponeres i bundle.
- Arbeidsgivervurderinger skal aldri kunne tilbakeføres til enkeltbidragsytere; aggregater vises kun over publiseringsterskelen.
- SECURITY DEFINER-funksjoner skal aldri ta bruker-ID som parameter for å avgjøre hvem kalleren er.

## Faste regler

1. **Rettigheter ved signaturendring.** Enhver migrasjon som endrer signaturen til en SECURITY DEFINER-funksjon (DROP + CREATE, eller ny parameterliste) må inkludere REVOKE/GRANT på nytt i samme migrasjon. `CREATE FUNCTION` gir default `EXECUTE` til `PUBLIC`, og en tidligere innstramming går tapt uten at noe feiler. Dette har skjedd i praksis (`brreg_full_merge`).
2. **service_role/postgres-prinsippet.** Interne funksjoner (kø, speiling, batch-merge, KI-commit, dedup-innsetting) skal ha `REVOKE ALL ... FROM PUBLIC, anon, authenticated` og kun `GRANT EXECUTE` til `service_role` (og `postgres` der pg_cron kaller dem).
3. **auth.uid() internt.** Funksjoner som avgjør tilgang skal utlede bruker internt fra `auth.uid()`, ikke fra en parameter. Referanse: `get_user_employers()` er parameterløs.
4. **Funksjoner opprettes via migrasjon.** Alle nye funksjoner i `public`-skjemaet opprettes via migrasjon, aldri direkte mot databasen. Om verktøy utenfor migrasjonssporet må opprette en funksjon direkte, skal definisjonen legges inn som `CREATE OR REPLACE FUNCTION` i en migrasjon i etterkant, samme økt. Dette er årsaken til at `email_queue_dispatch`/`email_queue_wake` manglet fra migrasjonssporet.
5. **Eksplisitt søkevei.** Enhver ny SECURITY DEFINER-funksjon skal ha eksplisitt `SET search_path` — tomt (`''`) der funksjonen fullt kvalifiserer alle objektreferanser, ellers `public, pg_temp`. Ingen ny SECURITY DEFINER-funksjon uten denne linjen skal merges.
6. **Sikkerhetsminnet er versjonert.** Enhver oppdatering av sikkerhetsminnet committes samtidig til `docs/sikkerhetsminne.md`.

## Aksepterte risikoer og unntak

### Advisor 0011/0014 (mutable search_path, extension in public)

Gjennomgått. Gjenværende treff gjelder eldre hjelpefunksjoner og utvidelser installert i `public` av plattformen. Endres etter hvert som funksjonene uansett røres; ikke egen sak.

### Advisor 0008 (RLS enabled, no policy / policy-eksponering på referansedata)

Registerdata (enheter, regnskap, næringskoder) og speilet av jobbannonser er felles referansedata med bevisst bred lesetilgang for innloggede brukere. Dette er akseptert og skal ikke flagges som brukerdatalekkasje.

### Advisor 0028/0029 (SECURITY DEFINER kallbar av anon/authenticated)

Unntaket gjelder **kun** funksjonene som er navngitt nedenfor. Listene er hentet direkte fra `pg_proc.proacl` (via `has_function_privilege`) 2026-08-25, ikke utledet fra migrasjonshistorikken. Funksjoner som ikke står på listen er reelt nye funn og skal vurderes på nytt, selv om de havner i samme advisor-kategori.

Kallbare av `anon` (og `authenticated`) — triggerfunksjoner, offentlig registeroppslag og `has_role` (16):

`career_atom_links_guard`, `career_atoms_eksponering_parent_check`, `career_atoms_recheck_links_trigger`, `count_employers`, `cv_claim_attestation_after_write`, `cv_claim_attestation_before_write`, `cv_claim_attestation_set_version`, `cv_claim_invalidate_attestation`, `cv_review_basis_reconcile`, `employer_ansatte_distribution`, `get_employer_analysis_view`, `get_employer_detail`, `get_employer_formaal`, `get_employer_regnskap_history`, `has_role`, `search_employers`.

Kallbare av `authenticated`, ikke av `anon` — brukerens egne operasjoner, alle scopet internt på `auth.uid()` (55):

`career_atom_add_manual_result`, `career_atom_link_decide`, `career_atom_link_override`, `career_atom_link_suggest`, `career_atom_links_mark_recheck`, `career_atom_project_evidence`, `career_atom_project_parent`, `career_atom_promote_parse_candidate`, `cv_atomization_job_cancel`, `cv_atomization_job_resume`, `cv_review_progress_advance`, `cv_review_progress_sync`, `cv_review_promote_result`, `cv_review_set_role_choice`, `delete_all_my_data`, `employer_review_ensure_target`, `employer_review_ensure_target_by_orgnr`, `employer_review_moderate`, `employer_review_search_status`, `employer_review_submit`, `employer_review_withdraw`, `get_admin_ingestion_status`, `get_employer_analysis_benchmark_report`, `get_employer_analysis_weight_config`, `get_employer_review_aggregate`, `get_my_employer_review`, `get_user_employers`, `internal_ai_get_cv_generation`, `linkedin_promote_career_record`, `linkedin_promote_job_preference`, `linkedin_promote_network_contact`, `linkedin_promote_profile_field`, `linkedin_promote_qualification`, `linkedin_promote_recommendation`, `linkedin_promote_saved_job`, `linkedin_promote_skill_or_signal`, `linkedin_promotion_record_failure`, `linkedin_promotion_reopen`, `linkedin_reconciliation_decide`, `list_regnskap_cron_runs`, `list_user_careerjet_leads`, `list_user_job_opportunities`, `match_user_opportunities_from_mirror`, `network_company_reconciliation_confirm`, `network_company_reconciliation_scan`, `network_company_reconciliation_set_state`, `network_link_recommendation_contact`, `network_unlink_recommendation_contact`, `network_update_contact_contact_points`, `network_update_contact_manual_profile`, `register_lead`, `reset_my_employer_analysis_weights`, `review_employer_analysis_model_run`, `set_employer_analysis_weight_profile`, `set_my_employer_analysis_weights`.

`has_role` må være kallbar av `anon` og `authenticated` fordi den evalueres inne i RLS-policyer.

**Rettet S1-regresjon 2026-08-25.** Åtte funksjoner (`delete_all_my_data`, `cv_atomization_job_cancel`, `cv_atomization_job_resume`, `cv_review_set_role_choice`, `cv_review_promote_result`, `network_company_reconciliation_scan`, `network_company_reconciliation_confirm`, `network_company_reconciliation_set_state`) var faktisk `anon`-kallbare i `pg_proc.proacl` selv om migrasjonene deres hadde korrekt `REVOKE ... FROM PUBLIC` + `GRANT ... TO authenticated`. De er nå strammet inn via migrasjon til `authenticated` + `service_role`. Læring: unntakslister skal alltid bygges fra live `pg_proc.proacl`, aldri fra migrasjonshistorikken alene.

### CSP

`Content-Security-Policy` kjører i `Report-Only` fordi appen fortsatt trenger `unsafe-inline` for stiler og enkelte inline-skript. Overgang til håndhevet CSP krever nonce-basert oppsett. Dette er kjent og akseptert inntil nonce er på plass. `/api/public/*` er unntatt sikkerhetsheaderne for ikke å bryte eksterne kallere.
