# Fase 3 — LinkedIn: avstemming til forslag og brukerens gjennomgang

Bygger et eget forslagslag oppå det ferdige `linkedin_*`-importlaget fra fase 2. Brukeren ser hva LinkedIn-eksporten foreslår, sammenligner mot det Karrierenmin allerede har, og tar en eksplisitt beslutning per forslag. Ingenting skrives til profil, karriere, kontakter, jobber eller dokumenter i denne fasen — godkjenning betyr kun «klar for senere promotering».

## 1. Datamodell (ny migrasjon, additiv)

Fire nye private tabeller, isolert fra `atom_enrichment_proposals`:

- `linkedin_reconciliation_runs` — én rad per deterministisk kjøring, med `input_signature` (bruker + formål + staging-records + avstemmingsversjon + normaliseringsversjon), tellere per utfall, og statusmaskin `queued → running → succeeded | partially_succeeded | failed | cancelled`. Identisk signatur gjenbrukes; ny regelversjon gir ny kjøring uten å slette historikk. Feil i ett domene tar ikke ned de andre.
- `linkedin_reconciliation_proposals` — frosne forslag med `proposal_domain` (profile, career, network, jobs, learning, content, recommendations, endorsements), `proposal_kind` (create, possible_duplicate, possible_update, conflict, keep_existing, deferred, not_actionable_in_phase_3), status (pending_review, approved_for_promotion, dismissed, deferred_by_user, needs_resolution, superseded, stale_source, stale_target), dataminimerte kilde-/målsnapshots med hash, `comparison_json`, `reason_codes`, `match_method`, `confidence` og `supersedes_proposal_id`.
- `linkedin_reconciliation_proposal_sources` — flere belegg per forslag (`primary`, `supporting`, `third_party_signal`, `third_party_recommendation`) med peker til staging-record.
- `linkedin_reconciliation_decisions` — append-only beslutningshistorikk (`approve_for_promotion`, `dismiss`, `defer`, `request_manual_edit`, `mark_not_mine`) med strukturert avvisningsårsak.

Alle koblinger håndheves med sammensatte FK-er på `user_id`, slik at et forslag aldri kan peke på en annen brukers staging-record. RLS: `anon` uten tilgang, `authenticated` kun SELECT på egne rader, all skriving via RPC.

## 2. Avstemmingsmotor (server-only, deterministisk)

Ny modul `src/lib/linkedin/reconciliation/*.server.ts` og intern rute `src/routes/api/internal/linkedin-reconciliation-worker.ts`, etter samme sikkerhetsmønster som fase 2: POST-only, worker-hemmelighet med konstant-tid-sammenligning før databasekontakt, sanitert feilformat, ingen logging av LinkedIn-innhold. Ingen modellkall.

Regler per domene:

- **Profil** — forslag per felt (headline, sammendrag, sted, bransje, profil-URL, språk). Tomt produktfelt → create. Identisk → keep_existing (ikke arbeidsoppgave). Ulikt → possible_update/conflict med begge verdier synlig. Manuelt redigert informasjon overskrives aldri.
- **Karriere** — matchrekkefølge: arbeidsgiver+tittel+overlappende periode, deretter arbeidsgiver+periode, deretter tittel+periode. Fuzzy gir kun possible_duplicate. Parallelle roller hos samme arbeidsgiver slås aldri sammen. Utdanning/kurs/sertifisering behandles separat fra roller.
- **Kompetanser og endorsements** — deterministisk canonical key + synonymtabell; fuzzy → possible_duplicate. Endorsements vises som tredjepartssignal (antall), aldri som ferdighetsnivå eller hard evidens.
- **Anbefalinger** — eget forslag med avsender, dato, tekst og LinkedIn-proveniens, tydelig merket som tredjepartsinformasjon. Aldri `documented`/`user_attested`, aldri automatisk inn i CV eller søknad.
- **Nettverk** — ingen skriving til `contacts`. Utfall: ny kontaktkandidat, mulig eksisterende kontakt, konflikt eller ikke aktuelt i fase 3. Match på profil-URL, deretter e-post (kun der brukeren selv har lagret den), deretter navn+selskap. Navnelikhet alene → possible_duplicate.
- **Jobber** — kun forslag om preferanser, søkeord, lokasjon, lagrede jobber og mulige jobbmål. Ingen `job_leads`, `user_opportunities` eller `job_applications`. Annonse-/klikkdata (klasse C) brukes ikke.
- **Læring og innhold** — utdanning/sertifisering → kvalifikasjonsforslag; artikler → profil-/porteføljemateriale med bevart kildehenvisning, aldri CV-påstand.

Klasse B gir ingen forslag (fortsatt utsatt). Klasse C vises aldri som enkeltinnhold. Formål brukeren ikke har valgt gir kontraktsstatus `skipped_no_selected_purpose` — produkttekst «ikke valgt for dette formålet». Dette er brukerens valg av behandlingsformål i produktet, ikke en egen samtykkemodell.

## 3. Gjennomgangsflate

Ny rute `/kildegjennomgang?source=linkedin&import=<id>`, adskilt fra CV-gjennomgangens fire trinn, men med samme navigasjons- og beslutningsspråk.

- **Oversikt**: importnavn og tidspunkt, valgte formål, antall staging-records per domene, forslagstellere (nye, mulige dubletter, konflikter, klare, utsatt, avvist), tydelig melding om at ingenting er lagt i profilen ennå, samt retention-status (arkiv tilgjengelig/fjernet, staging gyldig til).
- **Seksjoner** i rekkefølgen Profil, Karriere, Kompetanser, Anbefalinger, Nettverk, Jobber, Læring og innhold, Avvik. Kun seksjoner med valgt formål eller relevante forslag vises.
- **Forslagskort**: hva LinkedIn foreslår, hva Karrierenmin har, forskjellene, matchmetode og sikkerhet, kort forklaring, kilde/filtype/importtidspunkt, hva som skjer ved senere promotering, og status. Alle fem handlingene går via `linkedin_reconciliation_decide` og gir én append-only beslutningsrad: Godkjenn for senere bruk (`approve_for_promotion`), Behold eksisterende (`dismiss` + `reason_code=keep_existing`), Ikke importer (`dismiss` + valgt årsak), Utsett (`defer`), Rediger senere (`request_manual_edit`). Klienten setter aldri status selv.
- **Bulk** kun for homogene create-forslag med høy sikkerhet, uten mulig eksisterende match, konflikt eller anbefalingstekst; antall vises før handling. Ingen bulk for konflikt eller mulig dublett.
- **Språk**: «Foreslått fra LinkedIn-eksporten», «Oppgitt i LinkedIn-profilen», «Tredjeparts anbefaling», «Mulig samsvar». Aldri «bekreftet», «dokumentert» eller «validert».

## 4. RPC-er og tilgangskontroll

`linkedin_reconciliation_start`, `_get_status`, `_list_proposals`, `_decide`, `_reopen_or_supersede`. Eierskap kontrolleres både i databasen og serverlaget. SECURITY DEFINER med `search_path = ''` og fullt kvalifiserte referanser. Klienten skriver aldri direkte; forslagets status oppdateres atomisk av RPC-en som registrerer beslutningen.

## 5. Retention og staleness

Fase 2-reglene gjelder (7 dagers ZIP, 90 dagers staging). Endret produktmål → `stale_target` før eventuell promotering.

Ved manuell sletting, retention-sweep eller annen fjerning av siste aktive stagingkobling gjør prosedyren følgende i samme transaksjon, før staging fjernes:

1. markerer alle ikke-terminale koblede forslag `stale_source`
2. fjerner eller redigerer promoterbar `proposed_payload_json` og innholdstunge felter i `source_snapshot_json`
3. beholder kun minimalt revisjonsspor: forslag-id, domene, type, status, kildeklassifisering, hash, import-id, tidspunkt og årsak
4. fjerner source-koblinger som ellers ville peke mot slettet staging

Anbefalingstekst, kontaktopplysninger og annet rått LinkedIn-innhold skal ikke overleve staging-retention indirekte i forslagstabellene. Reimport etter purge gir ny kjøring uten å gjenopplive gamle beslutninger. Fase 4 skal alltid avvise promotering av `stale_source`, `stale_target`, `superseded` og `dismissed` forslag og kreve ny aktiv avstemming.

## 6. Validering og leveranse

Full syntetisk testsuite (ikke reell LinkedIn-eksport) med før/etter-tellinger som dokumenterer at `profiles`, `user_career_profiles`, `user_preference_atoms`, `career_atoms`, `career_atom_links`, `contacts`, `job_leads`, `user_opportunities`, `job_applications`, `documents` og `cv_claim_attestations` er uendret. Testmatrisen dekker alle utfallene i punkt 7 i instruksen: felt-utfall, rollematch og dubletter, parallelle roller, canonical/fuzzy kompetansematch, anbefaling og endorsement som tredjepart, kontaktmatch, klasse B/C, manglende samtykke, idempotens, ny regelversjon, stale_source/stale_target, kryssbruker-isolasjon og append-only beslutningslogg. UI verifiseres på desktop og mobil.

Leveranse: migrasjoner med datamodelloversikt, oppdatert `docs/linkedin-import-contract-v1.md` med fase 3-modellen, RPC-/tilgangsoversikt, avstemmingsregler per domene, testbar gjennomgangsflate, testmatrise med resultater og eksempler på nytt profilfelt, mulig rolleduplikat, anbefaling, endorsement, kontaktdublett og utløpt forslag.

Arbeidet stopper etter fase 3 — ingen promotering, kontaktregister, jobbmuligheter eller profiloppdatering bygges.
