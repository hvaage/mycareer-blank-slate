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

## 2. Fil-for-fil importplan

Til `supabase/functions/_shared/cv-skills/<skill>/` med `VERSION.ts` (skill-versjon + skjemaversjon) per katalog:

- `cv-atom-language-no/` (v1.0.0): `types.ts`, `normalizer.ts`, `prompt.ts`.
- `cv-evidence-graph/` (v2.0.0, skjema 1.1): `types.ts`, `validators.ts`, `deduplicate.ts`, `proposals.ts`, `crud.ts`, `converters/*`. Slås sammen med eksisterende `_shared/cv-evidence-graph/` — v4-felter og `name-lexicon.ts` beholdes, gammel katalog erstattes av re-eksport så eksisterende funksjoner ikke brekker.
- `cv-quality-no/` (v2.0.0): `quality.ts`, `rewrite-validator.ts`, `types.ts`, `checks/*` (6 filer).
- `cv-hallucination-guard/` (v2.0.0): `guard.ts`, `llm-judge.ts`, `types.ts`, `extractors/*` (4), `matchers/*` (2).
- `cv-ats-rules-no/` (v2.0.0): `ats-rules.ts`, `keyword-coverage.ts`, `types.ts`, `validators/*` (4).

I tillegg: `_shared/cv-skills/adapters/career-atom-adapter.ts` (career_atoms ⇄ skillens atomtype), `_shared/cv-skills/index.ts` som eneste kanoniske eksportflate. `SKILL.md` og `references/` legges i `docs/cv-skills/<skill>/` som dokumentasjon, aldri i prompten. Frontend importerer DTO-typer fra én generert kontraktfil (`src/lib/cv-skills-contract.ts`), ingen duplisering.

## 3. Pipeline

**Inntak:** parser → `cv-atom-language-no` (Claude, `NORMALIZATION_SYSTEM_PROMPT_NO`) → `validateNormalizationBatch()` → `cv-evidence-graph` validering/dedup → forslag i `atom_enrichment_proposals` → brukerreview → varig `career_atoms` med `confidence = verified`. Låste/bekreftede atoms endres aldri av AI.

**Generell CV:** hent verified atoms → frys `atom_snapshot` på dokumentversjon → `cv_general_generation` (blokker med supporting atom-id-er) → `checkQuality()` → evt. `cv_quality_rewrite` → `validateRewriteResponse()` → guard på endelig tekst → `validateCvDraft()` (ATS/GDPR) → render.

**Tilpasset CV:** verified atoms + krav-atoms fra `opportunity_requirement_atoms` → `evaluateKeywordCoverage()` før generering (exact/normalized/semantic_alias/unsupported) → utvalg og rangering → frys atom- og kravsnapshot → `cv_tailored_generation` → quality → rewrite-validering → guard → ATS format + endelig dekning → render. Unsupported krav vises som gap, skrives aldri inn.

Rewrite som endrer tekst ugyldiggjør guard-resultatet; guard kjøres på nytt. Hvert steg returnerer `ok | needs_review | blocked_validation | blocked_guard | provider_error | timeout`, og siste fullførte steg lagres slik at kjøringen kan gjenopptas uten duplikater.

## 4. Claude-klient, secrets og modellprofil

`_shared/claude/client.ts`: pinnet SDK, secret `ANTHROPIC_API_KEY`, eksplisitt `ANTHROPIC_API_VERSION`, valgfri `ANTHROPIC_API_BASE_URL` med Anthropic som standard, timeout, maxtokens, retry kun ved 429/5xx/nettverk med eksponentiell backoff, ingen modellfallback, logging av request-id, tokens, cache, responstid, status. Modell-id hentes alltid fra godkjent server-side profil. Rå CV-tekst logges aldri.

Nye tabeller: `ai_model_profiles` (task_key, model_id, status candidate/production/disabled, prompt_version, max_tokens, temperature, request_options, valid_from/to, created_by) med unik production per task, `ai_model_runs` (bruker, correlation-id, task, modell, promptversjon, input/output-hash, document/proposal/snapshot-id-er, tider, tokens, kostnad, prisversjon, retries, feiltype, validator/guard-resultat), `ai_model_profile_audit` (promotion/rollback).

Task keys som spesifisert (syv). Deterministiske validatorer får ingen profil.

## 5. Evaluering

`ai_eval_cases`, `ai_eval_runs`, `ai_eval_jobs` (én modell × én case per jobb, pending/running/succeeded/failed, tidsbudsjett, reaper for stale running), `ai_eval_scores`. Admin-only Edge Functions + admin-side under `/admin`. Startkandidater verifiseres mot Anthropic Models API før bruk: `claude-haiku-4-5-20251001`, `claude-sonnet-5`, `claude-opus-5`, valgfritt `claude-fable-5`. Modelliste oppdaterbar uten kodeendring. Evalsettet dekker de oppgitte norske semantikk-, eierskap-, tall-, dedup-, guard- og ATS-tilfellene. Måltall per task: schemavaliditet, sporbarhet, nye/tapte claims, eierskap, dedupepresisjon, guard FP/FN, ATS-dekning, tid, tokens, kostnad, blindvurdering. Promotion krever eksplisitt adminhandling med auditlogg og rollback; billigst er aldri tilstrekkelig grunn.

## 6. Migrasjoner og RLS

Alle additive:
1. `ai_model_profiles`, `ai_model_profile_audit` — ingen Data API-tilgang for vanlige brukere; kun `service_role` + admin via Edge Function.
2. `ai_model_runs` — eier kan lese egne rader; admin via `has_role`.
3. `ai_eval_*` — admin-only.
4. `documents`: legg til `document_kind` (general/tailored), `opportunity_id`, `requirement_ids`, `requirement_snapshot`, `ats_format_result`, `ats_relevance_result`, `model_run_ids`, `skill_versions`, `prompt_versions`, `approved_at` (kun det som mangler).
5. `cv_generation_jobs` for asynkron pipeline med steg-status og gjenopptak.
Alle nye brukertabeller: GRANT etter CREATE, RLS på, eierskapspredikat, UPDATE med både USING og WITH CHECK, adminpolicy via eksisterende `user_roles`/`has_role` — aldri `raw_user_meta_data`.

## 7. Frontend

`/cv-builder` erstatter stubben: valg mellom generell og tilpasset CV, framdrift mot jobbstatus (polling), visning av brukte godkjente erfaringer, atoms som trenger review, språkforslag, faktasjekk-status, ATS-status, versjon og eksport. Tilpasset variant krever valgt stilling og viser støttede, delvis støttede og unsupported krav samt hvilke formuleringer som ble tilpasset. Ingen modell- eller leverandørnavn i brukerflaten — kun «AI-analyse», «AI-forslag», «faktasjekk». Review-koblinger inn i eksisterende `career/atom-review.tsx` og `career/cv-review.tsx`. Adminflate under `/admin` viser modell-id, promptversjon, tokens, kostnad, tid og evalresultater.

## 8. Testplan og utrulling

Rekkefølge: (1) importer skillkode + full typecheck, (2) Claude-klient + kjøringslogg, (3) `propose-cv-atoms` (atom-language), (4) evidence validering/dedup/review/apply, (5) kobling til eksisterende import/review, (6) `generate-cv` generell, (7) `improve-cv-text` + guard + `evaluate-cv-ats`, (8) tilpasset CV med pre/post keyword coverage, (9) admin-eval, (10) RLS-, idempotens-, feil- og kostnadstester. Én Edge Function deployes om gangen og verifiseres med en ekte brukeravgrenset kjøring før neste. RLS-test med to brukere på atoms, forslag, dokumenter og kjøringer.

## 9. Åpne spørsmål

1. **Adapter kontra skjemaendring:** planen mapper skillenes `cv_evidence_atoms`/typenavn til `career_atoms` i ett adapterlag. Alternativet — å endre skillfilene direkte — bryter versjonssporbarheten. Bekreft adapter.
2. **Kompetanseatomer:** ontologien tillater ikke direkte belegg for kompetanse/eksponering. Forslag: `cv-atom-language-no`-kandidater av typen kompetanse lagres alltid som indirekte, avledet av rolle/resultat.
3. **Modell-ID-er:** `claude-sonnet-5`, `claude-opus-5` og `claude-fable-5` må verifiseres mot Models API ved implementering; hvis de ikke finnes, brukes nyeste pinnede tilgjengelige og listen oppdateres i data, ikke kode.
4. **Eksport til DOCX/PDF:** Edge-runtime har ingen native binærer. Foreslår HTML→PDF-rendering og en ren-JS DOCX-generator; bekreft at det er godt nok.
