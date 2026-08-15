# Karriereontologi v4 — første leveranse (1.1 og plan for 1.3)

Prosjektreferanse bekreftet: `miwzhbludgwvskmsfqnq` (`current_database()` = `postgres`). Alle tall under er lest fra denne referansen nå. Ingen migrasjoner kjøres før denne planen er gjennomgått.

## 1.1 Levninger — hva som fjernes, med radtall og kodetreff

| Objekt | Rader | Kodetreff (utenom `types.ts` og migrasjoner) | Vurdering |
|---|---|---|---|
| `user_evidence_atoms` | 17 | `atom-enrichment.ts`, `atom-explicit-writes.ts`, `career-atoms.ts`, `career-atom-refresh.ts`, `queries/career-atoms.ts`, `atom-proposal-generation.ts`, `score-pending-opportunities` | Fjernes i 1.2/1.3 — men først etter at fase 2.1/2.2 har fått ny modell å lese. Tabellen kan ikke slippes samtidig som koden fortsatt leser den. |
| `user_preference_atoms` | 35 | samme seks filer | Samme rekkefølgeavhengighet. Erstattes av `onske`/`verdi`/`begrensning`. |
| `atom_evidence_links` | 0 | ingen | Slippes nå. |
| `career_atoms` (view) | – | ingen | Slippes nå. |
| `job_applications` | 0 | ingen | Slippes nå. |
| `cv_consent_log` | 0 | ingen | Slippes nå. Samtykkelogging tas opp igjen når gjennomgangsflyten (2.3) definerer hva som faktisk samtykkes til. |
| `documentation_package_items` | 0 | ingen | Slippes nå. |
| `documentation_packages` | 0 | `queries/documentation.ts` | **Lar stå** i 1.1. Den har en aktiv spørring; fjerning hører til opprydding av dokumentasjonsflaten, ikke til ontologifundamentet. |
| `positioning_recommendations` | 0 | `queries/match-assessments.ts`, `match-assessment-model.ts` | **Lar stå** i 1.1. Erstattes av anbefalingslaget i 3.5; å slippe den nå etterlater to ødelagte filer uten gevinst. |
| `professional_cases` / `professional_results` | 0 / 0 | `queries/documentation.ts` | **Lar stå** til 1.3 er i drift, da innholdet mappes inn i atommodellen (se punkt 3). |

Kolonner som fjernes fra `cv_evidence_atoms` i 1.3 (alle uten adferd, verifisert mot kodetreff):
`relevance_score` (default 0, settes aldri), `evidence_scope`, `career_stage_relevance`, `role_relevance_tags`, `dedupe_key`, `canonical_atom_id`. Ingen av dem har treff utenfor `types.ts` og migrasjonene.

`applications.dedupe_key` og `relevance_score` i jobbsøk-/markedskoden er andre kolonner på andre tabeller og røres ikke.

## 1.2 Sletting av brukerdata

Nøyaktig omfang, per nå: 4 brukere i auth, 17 rader `user_evidence_atoms`, 35 rader `user_preference_atoms`, 1 rad `cv_imports`, 0 rader `cv_evidence_atoms`, 2 rader `applications`, 2 rader `atom_enrichment_proposals`.

Forslag: `applications` (2 rader) beholdes — de er dimensjon G og ikke del av ontologien som bygges om. Bekreft om de likevel skal med.

Sletting skjer først etter at brukerne er informert og du har godkjent listen over.

## 1.3 Skjemaforslag — ny atommodell

Én tabell, `career_atoms_v4` (navn kan settes til `career_atoms` etter at viewet er sluppet).

**Identitet og innhold**
`id uuid pk`, `user_id uuid not null`, `atom_kind text not null` (`evidens`, `mangel`, `onske`, `maal`, `begrensning`, `verdi`), `atom_type text` (kun for evidens: role, achievement, metric, context, tool, education, skill, domain, language, certification, project, volunteer), `atom_class text generated always as (...) stored` avledet av `atom_type` — kan ikke settes fra applikasjonen, `parent_atom_id uuid references career_atoms_v4(id) on delete cascade`, `content_no text`, `content_en text`, `structured_data jsonb not null default '{}'`.

**Kilde og sporbarhet**
`source_type text not null`, `source_ref text`, `source_quote text`, `evidence_atom_ids uuid[] not null default '{}'`.

**De tre aksene**
`confidence text not null default 'imported'` (`imported`, `inferred`, `verified`), `attestation text` (`selvrapportert`, `dokumentert`, `bekreftet_av_leder`, `bekreftet_tredjepart`) — kun evidens, `viktighet smallint` 1–6 — kun `onske`, `verdi`, `begrensning`.

**Tilstand og ferskhet**
`user_confirmed boolean not null default false`, `user_locked boolean not null default false`, `is_active boolean not null default true`, `refreshed_at timestamptz`, `stale_at timestamptz`, `last_seen_at timestamptz`, `created_at`, `updated_at` med trigger.

**Mål og gyldighet**
`due_at timestamptz` og `state text` for `maal` (`planlagt`, `i_arbeid`, `oppnadd`, `forkastet`). `valid_from date` / `valid_to date` for `begrensning`. `mangel_state text` (`identifisert`, `i_arbeid`, `lukket`, `forkastet`) pluss `target_position_id` og `target_requirement_id` — begge NOT NULL for `mangel`, lagt til først i 3.1/3.3 slik at ingen felt står uten adferd.

**Constraints (håndheves i databasen)**
1. `atom_type` er NOT NULL når `atom_kind='evidens'`, og NULL ellers.
2. `attestation` kun når `evidens`; `viktighet` kun for `onske`/`verdi`/`begrensning`, verdiområde 1–6.
3. `parent_atom_id` kun tillatt når `atom_kind='evidens'`.
4. `atom_class='kompetanse' and confidence='verified'` krever `array_length(evidence_atom_ids,1) >= 1`.
5. `atom_class='eksponering'` krever `parent_atom_id` som peker på et atom med `atom_type='role'` — håndheves med trigger, ikke CHECK, siden den slår opp en annen rad.
6. `atom_kind='maal'` krever `state`; `atom_kind='mangel'` krever målposisjon og krav (fra 3.1).
7. Ingen tallakse uten betydning: `relevance_score` finnes ikke i skjemaet.

**Indekser**
`(user_id, atom_kind, is_active)`, `(user_id, atom_class)` partial på evidens, `(parent_atom_id)`, GIN på `evidence_atom_ids`, `(user_id, stale_at)` partial på aktive.

**Tilgang**
GRANT select/insert/update/delete til `authenticated`, ALL til `service_role`, ingen `anon`. RLS: alle policyer scopet til `auth.uid() = user_id`.

## Åpne punkter — mitt standpunkt

**`professional_cases` / `professional_results` inn i atommodellen.** Casen blir ett atom med `atom_type='project'`: `title` → `content_no`, `summary`/`situation`/`responsibility`/`actions_taken` → STAR-felter i `structured_data`, `company_name`/`industry`/`role_context`/`time_period` → `structured_data`, `status` → `user_confirmed` pluss `is_active`, `visibility` faller bort (RLS dekker det). `results` (fritekst) blir ikke med som felt — den splittes til barneatomer med `atom_type='achievement'`, og tall som lar seg kvantifisere blir `metric`. `career_stage_relevance` faller bort. Begge tabellene er tomme, så dette er en skjemabeslutning, ikke en datamigrasjon.

**Styreverv.** `employment_type` utvides med `styreleder`, `styremedlem`, `varamedlem`, `nestleder`, `observator`, `radsmedlem`. Valgperiode og honorar i `structured_data`: `valgt_fra`, `valgt_til`, `valgperiode_ar`, `gjenvalg` (bool), `honorar_belop`, `honorar_valuta`, `honorar_periode`. Vervet er et `role`-atom som alle andre roller, med `orgnr` i `structured_data`.

**Årlig påminnelse på `begrensning`.** Enkleste form nå: `valid_to` settes til ett år fram ved opprettelse, og en daglig jobb i den eksisterende driftsvarslingen finner begrensninger som nærmer seg `valid_to` og oppretter et forslag i beslutningsloggen — ikke en automatisk endring. Brukeren bekrefter, forlenger eller fjerner. Full hendelsesbasert påminnelse hører til 3.6 og bygges ikke nå.

## Hva jeg trenger svar på før migrasjonen skrives

1. Skal `applications` (2 rader) også slettes, eller beholdes?
2. Tabellnavn: `career_atoms_v4` med senere omdøping, eller nytt navn direkte etter at viewet `career_atoms` er sluppet?
3. Godkjenner du at `documentation_packages` og `positioning_recommendations` står urørt i 1.1?
