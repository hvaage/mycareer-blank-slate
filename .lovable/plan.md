# CV-skills v2 i Karrierenmin: inspeksjonsrapport og implementeringsplan

## 1. Inspeksjonsfunn (faktiske navn)

### Aktiv atommodell
`public.career_atoms` er den eneste aktive atomtabellen (karriereontologi v4). `cv_evidence_atoms` og `user_evidence_atoms` finnes **ikke lenger** i databasen. Kolonner: `atom_kind`, `atom_type`, `atom_class` (DB-satt), `parent_atom_id`, `content_no/en`, `structured_data`, `source_type/ref/quote`, `evidence_atom_ids`, `confidence`, `attestation` (DB-satt), `user_confirmed`, `user_locked`, `is_active`, `state`, `mangel_state`, `refreshed_at/stale_at`, `target_position_id`, `target_requirement_id`.
Dagens innhold: 5 `role`, 1 `achievement`, 1 `education`, 2 `language` — alle `confidence = verified`.

### Runtime-moduler som allerede finnes
- `supabase/functions/_shared/cv-evidence-graph/` finnes allerede (types, validators, deduplicate, crud, converters, `name-lexicon.ts`) — men er en **v4-tilpasset variant**, ikke identisk med skillens v2/1.1-filer. Alle fire kjernefiler avviker.
- De fire andre skillene (`cv-atom-language-no`, `cv-quality-no`, `cv-hallucination-guard`, `cv-ats-rules-no`) finnes **ikke** i kodebasen.

### Gjenbrukbare tabeller og funksjoner
- Forslag/review: `atom_enrichment_batches` + `atom_enrichment_proposals` (har provenance, `source_hash`, `proposal_payload`, `existing_atom_snapshot`, `diff`, `confidence`, `inferred`, review-felter). Skal gjenbrukes — ingen parallell proposal-modell.
- Importlag: `cv_imports`, `cv_parse_candidates`, funksjonene `parse-uploaded-cv`, `commit-cv-import`, frontend `career/cv-review.tsx`, `career/atom-review.tsx`.
- Dokumenter: `public.documents` har allerede `atom_ids`, `atom_snapshot`, `guard_result`, `guard_version`, `quality_result`, `ats_rules_version`, `render_template_version`, `render_language`, `version`, `is_base_version`, `tailored_for`. Dette dekker mesteparten av sporbarhetskravet.
- Krav-atoms for stilling: `opportunity_requirement_atoms` (kategori, dimensjon, `normalized_value`, `requirement_level`, `importance_score`, `evidence_excerpt`).
- Claude finnes allerede server-side i `analyze-company`, `generate-cover-letter`, `parse-uploaded-cv` med `ANTHROPIC_API_KEY` og header `anthropic-version: 2023-06-01`, men uten felles klient.
- Kjøringslogg-mønster finnes som `employer_analysis_model_runs` (+ `employer_analysis_model_run_reviews`, `employer_analysis_weight_profiles`) — riktig mønster, men bundet til selskapsanalyse. Ingen generisk modellprofil-/kjøringstabell finnes.
- `supabase/functions/_shared/preflight.ts` gir etablert fail-fast-mønster for secrets.

### Konflikter mellom skillkontrakt og faktisk schema
1. **Tabellnavn:** skillene refererer gjennomgående `cv_evidence_atoms`. Kanonisk tabell er `career_atoms`. Løses med ett adapterlag, ikke ved å gjenopplive gammel tabell.
2. **Atomtyper:** skillens typeliste (`role`, `achievement`, `metric`, `context`, `tool`, …) mot v4s `atom_kind` + `atom_type` + DB-satt `atom_class`. Krever eksplisitt typekart; `atom_class` og `attestation` skrives aldri fra kode.
3. **`cv-evidence-graph` finnes i to versjoner** (repo-variant vs. skill 2.0.0/skjema 1.1). Må slås sammen, ikke dupliseres.
4. **Ontologiregel:** kompetanse/eksponering kan ikke belegges direkte. Skillens frie `skill`-atomer fra tekst må derfor bli forslag knyttet til rolle/resultat.
5. **CV-bygger finnes ikke:** `/cv-builder` er en `ComingSoonStub` (51 linjer). Hele generering, quality/guard/ATS-visning og eksport må bygges.
6. **Ingen generisk modellprofil/-kjøring:** må opprettes (ny, ikke parallell til employer-tabellene, som beholdes uendret).

### Kan gjøres uten migrasjon
Import av skillkode, felles Claude-klient, deterministiske validatorer (quality, ATS-format/GDPR, hard-claim-matching, keyword coverage), all bruk av `atom_enrichment_*`, og all lagring på eksisterende `documents`-kolonner.

## 2. Fil-for-fil importplan (leverandørkode, ingen sammenslåing)

Skillpakkene importeres uendret som versjonert leverandørkode til `supabase/functions/_shared/cv-skills/<skill>/`, med `VERSION.ts` per katalog. De redigeres ikke under import. Eksisterende `_shared/cv-evidence-graph/` (v4-runtime) forblir kanonisk domenemodell og røres ikke.

- `cv-atom-language-no/` (v1.0.0): `types.ts`, `normalizer.ts`, `prompt.ts`.
- `cv-evidence-graph/` (v2.0.0, skjema 1.1): kun **rene** moduler — `types.ts`, `validators.ts`, `deduplicate.ts`, `proposals.ts`, `converters/*`. **`crud.ts` importeres ikke**; skillens generiske CRUD mot `cv_evidence_atoms` skal aldri kunne kjøre.
- `cv-quality-no/` (v2.0.0): `quality.ts`, `rewrite-validator.ts`, `types.ts`, `checks/*` (6 filer).
- `cv-hallucination-guard/` (v2.0.0): `guard.ts`, `llm-judge.ts`, `types.ts`, `extractors/*` (4), `matchers/*` (2).
- `cv-ats-rules-no/` (v2.0.0): `ats-rules.ts`, `keyword-coverage.ts`, `types.ts`, `validators/*` (4).

**Ingen sammenslåing.** Skill-v2 lever isolert under `cv-skills/`; eksisterende `_shared/cv-evidence-graph/` (v4) er kanonisk domenemodell og endres ikke. De to kodebasene importerer aldri hverandre. Adapterlaget `_shared/cv-skills/adapters/career-atom-adapter.ts` er eneste kobling mellom dem.

Alle skriveoperasjoner går gjennom eksisterende v4 apply-/review-flyt (`atom_enrichment_proposals` → godkjenning → apply, promotering fra `cv_parse_candidates`) — aldri gjennom skillkode. **`career_atom_delete` inngår ikke i CV-skillflyten:** AI og import kan bare opprette forslag; ingen automatisk sletting eller deaktivering av atoms. `SKILL.md` og `references/` ligger i `docs/cv-skills/<skill>/` og sendes aldri i prompten. Frontend importerer DTO-er fra én kontraktfil (`src/lib/cv-skills-contract.ts`).

## 3. Pipeline

### Inntak og atomisering
parser → `cv-atom-language-no` (Claude, `NORMALIZATION_SYSTEM_PROMPT_NO`) → `validateNormalizationBatch()` → skillens validering/dedup → forslag i `atom_enrichment_proposals` → brukerreview → apply via v4-funksjon.

Regler ved apply:
- Direkte brukerbekreftede fakta (rolle, resultat, kvalifikasjon) kan få `confidence = verified` og `user_confirmed = true`.
- Importgodkjenning følger v4-tabellens eksisterende tilstandsmaskin (`state`, `mangel_state`), ikke en egen AI-regel.
- Kompetanse og eksponering lagres som **avledet** metadata med `evidence_atom_ids` mot rolle/resultat, aldri som selvstendig faktagrunnlag.
- `atom_class` og `attestation` settes av databasen. Edge Function og frontend skriver dem aldri.
- `user_locked` og `user_confirmed` atoms overskrives aldri av AI eller import.

### Kanonisk eligibility-funksjon
`eligibleAtomsForGeneration({ mode, opportunity_id })` er eneste kilde til hvilke atoms som kan brukes. **Identiteten hentes fra verifisert JWT** — aldri fra `user_id` i request — og valgt opportunity må tilhøre samme bruker, ellers avvises kallet.

Predikat: `is_active = true`, godkjent `state`, `confidence = verified`, gyldig `attestation`, `user_confirmed = true`, akseptabelt `mangel_state`, og filter på `target_position_id` slik at målspesifikke atoms aldri lekker inn i generell CV. `imported` og `inferred` blir aldri faktagrunnlag. `stale_at` gir **varsel**, ikke automatisk blokkering: historiske fakta blir ikke ugyldige av alder. Avledet kompetanse brukes bare til utvalg og rangering; supporting evidence i teksten er alltid de underliggende rolle-/resultat-atomene.

Funksjonen returnerer readiness-status i stedet for et ja/nei: `ready`, `ready_with_gaps`, `needs_review`, `blocked_no_evidence`. Ingen massebekreftelse av eksisterende data.

### Blokk- og claimkontrakt
Generering returnerer strukturert JSON, ikke fritekst:

```text
document: { documentVersionId, outputHash, snapshotHash }
blocks[]: { blockId, section, text, supportingAtomIds[], requirementAtomIds[], claimIds[], sourceSnapshotHash }
claims[]: { claimId, blockId, type: hard|soft, value, supportingAtomIds[], verification }
```

`claimId`, `blockId` og alle hasher genereres av serveren, aldri av modellen. Hver Claude-respons runtime-valideres mot kontrakten før lagring; ugyldig respons lagres ikke og gir `blocked_validation`. Én blokk = én punktlinje eller én sammenhengende claim. Quality-, guard- og ATS-resultater lagres alltid med den `outputHash` de ble kjørt på; enhver senere endring — også manuell brukerredigering — ugyldiggjør kontrollene og krever ny kjøring.

### Generell CV
eligible atoms → ny dokumentversjon + frosset atom-snapshot i **én DB-transaksjon** via én autorisert RPC → `cv_general_generation` → `checkQuality()` → evt. `cv_quality_rewrite` → `validateRewriteResponse()` → guard på endelig tekst → `validateCvDraft()` (ATS/GDPR) → render av godkjent versjon.

### Tilpasset CV
eligible atoms + krav-atoms fra `opportunity_requirement_atoms` → `evaluateKeywordCoverage()` før generering (exact / normalized / semantic_alias / unsupported) → utvalg og rangering → dokumentversjon + atom- og kravsnapshot i samme transaksjon → `cv_tailored_generation` → quality → rewrite-validering → guard → ATS-format + endelig dekning → render. Unsupported krav vises som gap og skrives aldri inn.

Hvert steg returnerer `ok | needs_review | blocked_validation | blocked_guard | provider_error | timeout`.

### Immutable dokumentversjoner
Ny generering eller rewrite oppretter alltid **ny** dokumentversjon gjennom samme transaksjonelle RPC. Godkjente og tidligere versjoner endres aldri. Flere sekvensielle klientkall er ikke en akseptabel erstatning for transaksjonen. `ai_model_runs` får FK til dokumentversjonen. Dokumentrot håndteres med `document_group_id` (se preflight punkt c), med unik constraint på (`document_group_id`, `version`) etter at eksisterende rader er migrert.

## 4. Claude-klient, secrets og modellprofil

`_shared/claude/client.ts`: pinnet Anthropic SDK med lockfile, secret `ANTHROPIC_API_KEY`, eksplisitt `ANTHROPIC_API_VERSION` logget per kjøring. **Ingen fri base-URL** — endepunktet er låst til Anthropics offisielle API. Timeout, maks tokens, retry kun ved transient 429/5xx/nettverk med eksponentiell backoff, ingen modellfallback, logging av request-id, tokens, cache, responstid og status. Rå CV-tekst logges aldri. Modell-id kommer alltid fra godkjent server-side profil.

`request_options` valideres mot modellens capabilities før kall: parametere modellen ikke støtter (blant annet `temperature` på Sonnet 5-generasjonen) utelates i stedet for å sendes og feile.

Nye interne tabeller: `ai_model_profiles` (task_key, model_id, status, prompt_version, max_tokens, request_options, valid_from/to, created_by) med unik production-profil per task, `ai_model_runs`, `ai_model_profile_audit`, `ai_model_pricing` (input-, output- og cachepris per modell med gyldighetsperiode). Hver kjøring lagrer et immutable `pricing_snapshot`; faktiske tokenverdier lagres alltid, også når kostnaden ikke kunne beregnes.

Task keys som spesifisert (syv). Deterministiske validatorer får ingen modellprofil.

## 5. Evaluering

`ai_eval_cases`, `ai_eval_jobs` (én modell × én case per jobb: pending/running/succeeded/failed, tidsbudsjett, reaper for stale running), `ai_eval_runs`, `ai_eval_scores`. Admin-only Edge Functions og adminflate. Startkandidater (verifiseres mot Models API ved implementering): `claude-haiku-4-5-20251001`, `claude-sonnet-5`, `claude-opus-5`, valgfritt `claude-fable-5`. Modellisten er data, ikke kode. Evalsettet dekker de oppgitte norske semantikk-, eierskaps-, tall-, dedup-, guard- og ATS-tilfellene. Måltall per task: schemavaliditet, sporbarhet, nye/tapte claims, eierskap, dedupepresisjon, guard FP/FN, ATS-dekning, tid, tokens, kostnad, blindvurdering. Promotion er eksplisitt adminhandling med auditlogg og rollback; lav pris er aldri tilstrekkelig grunn.

## 6. Migrasjoner, RLS, RPC-tilgang og jobbkjøring

### ai-schemaet er ueksponert
Interne tabeller (`ai.model_profiles`, `ai.model_runs`, `ai.model_profile_audit`, `ai.model_pricing`, `ai.eval_*`) ligger i schema `ai`, som ikke legges til Data API. Ingen grants til `anon`/`authenticated`. Tilgang skjer kun gjennom smale `SECURITY DEFINER`-RPC-er med `set search_path = ''` og fullt kvalifiserte navn; hver RPC får `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` og `GRANT EXECUTE ... TO service_role`. Edge Function verifiserer JWT og eierskap **før** service-klienten brukes. Frontend kaller aldri RPC-ene direkte — den snakker bare med Edge Functions og får sanitert status.

`public`-tabeller som frontend faktisk leser (dokumenter, forslag, atoms) beholder RLS med eierskapspredikat og UPDATE-policy med både `USING` og `WITH CHECK`. Adminpolicy bygger på `public.has_role`, som er verifisert `SECURITY DEFINER` med `search_path=public` (EXECUTE-rettigheter kontrolleres og strammes ved behov).

### documents
Additivt: `document_group_id`, `document_kind` (general/tailored), `opportunity_id`, `requirement_ids`, `requirement_snapshot`, `ats_format_result`, `ats_relevance_result`, `output_hash`, `skill_versions`, `prompt_versions`, `approved_at`. Migreringsregel: eksisterende rader får `document_group_id = id` (alle ni dagens dokumenter er versjon 1 uten lineage), deretter opprettes unik constraint på (`document_group_id`, `version`).

### Varig jobborkestrering
Frontendrequest **oppretter bare en jobb** og får jobb-id tilbake. En worker startet av `pg_cron` + `pg_net` claimer ett steg om gangen atomisk (`FOR UPDATE SKIP LOCKED`), utfører ett modellkall og legger jobben tilbake i kø. Cron-secret ligger i Vault; endepunktet ligger under `/api/public/*` og autoriserer kalleren selv.

`cv_generation_jobs`: `id`, `user_id`, `document_group_id`, `job_kind`, `idempotency_key` (unik per bruker+input), `input_hash`, `status`, `last_completed_step`, `next_step`, `attempt_count`, `max_attempts`, `available_at`, `locked_at`, `lease_expires_at`, `heartbeat_at`, `worker_id`, `time_budget_ms`, `counters jsonb`, `error_code`, `error_detail`, `created_at`, `updated_at`. Reaper frigjør jobber med utløpt lease. Frontend poller kun status.

### ai.model_runs på kolonnenivå
`id uuid pk`, `user_id uuid not null`, `correlation_id text not null`, `job_id uuid` (FK → `public.cv_generation_jobs`), `document_version_id uuid` (FK → `public.documents`), `proposal_id uuid`, `task_key text not null`, `profile_id uuid not null` (FK → `ai.model_profiles`), `model_id text not null`, `anthropic_api_version text not null`, `skill_version text not null`, `prompt_version text not null`, `request_options_snapshot jsonb not null`, `input_hash text not null`, `output_hash text`, `anthropic_request_id text`, `input_tokens int`, `output_tokens int`, `cache_read_tokens int`, `cache_write_tokens int`, `pricing_snapshot jsonb`, `estimated_cost_usd numeric`, `cost_complete boolean not null default false`, `retry_count int not null default 0`, `status text not null check (status in ('ok','needs_review','blocked_validation','blocked_guard','provider_error','timeout'))`, `error_code text`, `validator_result jsonb`, `guard_result jsonb`, `started_at`, `finished_at`, `duration_ms int`, `created_at`.

Indekser: `(user_id, created_at desc)`, `(task_key, model_id, created_at desc)`, `(job_id)`, `(document_version_id)`, `unique (correlation_id, task_key, input_hash)` for idempotens. Tokenverdier lagres alltid, også når kostnad ikke kunne beregnes.

### Personvernport før produksjon
Dataminimering (kun nødvendige segmenter til modellen, aldri rå CV i driftslogg), oppdatert behandlingsinformasjon til brukeren, definert retention og sletting for jobber, kjøringer og snapshots (koblet til eksisterende `delete-account`), og evalcase som er syntetiske eller eksplisitt anonymiserte. Porten må være passert før første produksjonskjøring.

## 7. Frontend

Første versjon av `/cv-builder` er en evidensport, ikke en full byggeflate — i dag finnes bare ni atoms:
1. Velg generell eller tilpasset CV.
2. Kontroller om det finnes nok godkjent evidens.
3. Ved mangler: send brukeren til import/gjennomgang.
4. Generer utkast (jobbstatus via polling).
5. Vis faktasjekk, relevante gap og eksport.

Atom-id-er, kvalitetssjekker og ATS-detaljer ligger bak «Se grunnlag». Tilpasset variant krever valgt stilling og viser støttede, delvis støttede og unsupported krav. Ingen modell- eller leverandørnavn i brukerflaten — kun «AI-analyse», «AI-forslag», «faktasjekk». Koblinger inn i eksisterende `career/atom-review.tsx` og `career/cv-review.tsx`. Adminflate under `/admin` viser modell-id, promptversjon, tokens, kostnad, tid og evalresultater.

## 8. Leveransedeling, test og utrulling

1. Rene skillmoduler, adapter og Claude-klient (+ full typecheck).
2. Atomforslag, review og v4-apply.
3. Generell CV med immutable versjonering og kontrollkjede.
4. Stillingstilpasset CV med pre/post keyword coverage.
5. Eksport: DOCX først, PDF etter verifikasjon.
6. Admin-evaluering og bred modellmatrise.

Eksport bygges på **én strukturert dokumentmodell** som kilde for både DOCX og PDF. Akseptansetest for eksport: visuell rendering, tekstekstraksjon fra begge formater, riktig rekkefølge på overskrifter og punktlister, ingen tabellbasert layout, og samme innholdshash som før rendering.

Én Edge Function deployes om gangen og verifiseres med en ekte brukeravgrenset kjøring før neste. Øvrig testplan: RLS-test med to brukere på atoms, forslag, dokumenter og kjøringer; idempotens- og reaper-test på jobbkøen; feilinjeksjon mot Claude (429, 5xx, timeout); kostnads- og tokenlogging uten rå CV-tekst.

## 9. Åpne spørsmål

1. **Avledet kompetanse:** brukes til utvalg og rangering, aldri som supporting evidence i teksten. Bekreft grensen.
2. **Stale-terskel:** hvilken alder på `stale_at` skal blokkere bruk i CV, kontra bare varsle i grunnlagsvisningen?
3. **Modell-ID-er** verifiseres mot Models API ved implementering; avvik oppdateres i data, ikke kode.
4. **PDF-tidspunkt:** DOCX først er lagt til grunn; bekreft at PDF kan komme i en senere leveranse.
