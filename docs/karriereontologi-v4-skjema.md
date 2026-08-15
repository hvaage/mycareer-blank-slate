# Karriereontologi v4 — skjema for `public.career_atoms` (fase 1.3)

Prosjektreferanse: `miwzhbludgwvskmsfqnq`. Status: godkjent skjema, migrasjon ikke skrevet ennå.

Tabellnavnet er `career_atoms` uten versjonsnummer. Viewet med samme navn er sluppet i fase 1.1.

## Kolonner

### Identitet og innhold
| Kolonne | Type | Merknad |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `user_id` | uuid not null | FK `auth.users` on delete cascade |
| `atom_kind` | text not null | `evidens`, `mangel`, `onske`, `maal`, `begrensning`, `verdi` |
| `atom_type` | text | kun evidens: role, achievement, metric, context, tool, education, skill, domain, language, certification, project, volunteer |
| `atom_class` | text generated always as (…) stored | avledet av `atom_type`; kan ikke settes fra applikasjonen |
| `parent_atom_id` | uuid | self-FK, kun innenfor `evidens` |
| `content_no`, `content_en` | text | |
| `structured_data` | jsonb not null default `'{}'` | se validator under |

### Kilde og sporbarhet
`source_type` (not null), `source_ref`, `source_quote`, `evidence_atom_ids uuid[] not null default '{}'`.

### De tre aksene
| Kolonne | Betydning | Gjelder |
|---|---|---|
| `confidence` text not null default `imported` | opprinnelse: `imported`, `inferred`, `verified` | alle slag |
| `attestation` text | hvem som står bak: `selvrapportert`, `dokumentert`, `bekreftet_av_leder`, `bekreftet_tredjepart` | kun `evidens` |
| `viktighet` smallint | hvor mye det betyr for brukeren, 1–6 | `onske`, `verdi`, `begrensning` |

Evidens har ingen tallvekt. `relevance_score` finnes ikke.

**Kolonnekommentar på `viktighet`** (settes i migrasjonen, ordrett):

```
1 = uvesentlig, nevnt men uten vekt
2 = svak preferanse, ville ikke påvirket et valg alene
3 = reell preferanse, teller når alt annet er likt
4 = viktig, veier tyngre enn flere mindre forhold
5 = svært viktig, må adresseres for at et alternativ skal være aktuelt
6 = avgjørende, brudd på denne diskvalifiserer alternativet
Skalaen er brukerens egen vurdering, ikke systemets. Den er identisk med
1–6-skalaen i user_career_profiles. Den skal ikke normaliseres til 0–1.
```

### Tilstand og ferskhet
`user_confirmed`, `user_locked`, `is_active` (bool not null), `refreshed_at`, `stale_at`, `last_seen_at`, `created_at`, `updated_at` (trigger).

Ferskhet deaktiverer aldri evidens automatisk. Et gammelt resultat er gammelt, ikke utdatert.

### Mål, mangel og gyldighet
| Kolonne | Merknad |
|---|---|
| `due_at` timestamptz | frist for `maal` |
| `state` text | `maal`: `planlagt`, `i_arbeid`, `oppnadd`, `forkastet` |
| `mangel_state` text | `identifisert`, `i_arbeid`, `lukket`, `forkastet` |
| `valid_from`, `valid_to` date | gyldighetsperiode for `begrensning` |
| `target_position_id` uuid | gjelder både `mangel` og `maal` |
| `target_requirement_id` uuid | gjelder `mangel` |

`target_position_id` legges til på `maal` av samme grunn som på `mangel`: uten koblingen blir mål og målposisjon to parallelle representasjoner av det samme. Begge kolonnene er nullbare inntil fase 3.1 finnes, og settes NOT NULL (for de aktuelle slagene) i samme leveranse som målposisjonstabellen — ikke før.

## Constraints (i databasen)

1. `atom_type` NOT NULL når `atom_kind='evidens'`, NULL ellers.
2. `attestation` kun for `evidens`.
3. `viktighet` kun for `onske`/`verdi`/`begrensning`, mellom 1 og 6.
4. `parent_atom_id` kun for `evidens`.
5. `atom_class='kompetanse' AND confidence='verified'` krever minst én oppføring i `evidence_atom_ids`.
6. `atom_class='eksponering'` krever at `parent_atom_id` peker på et atom med `atom_type='role'` — trigger, ikke CHECK, siden den slår opp en annen rad.
7. `atom_kind='maal'` krever `state`; `atom_kind='mangel'` krever `mangel_state`.
8. `atom_kind='begrensning'` krever `valid_from`.

## Indekser
`(user_id, atom_kind, is_active)`, partial `(user_id, atom_class) where atom_kind='evidens'`, `(parent_atom_id)`, GIN på `evidence_atom_ids`, partial `(user_id, stale_at) where is_active`.

## Tilgang
GRANT select/insert/update/delete til `authenticated`, ALL til `service_role`, ingen `anon`. RLS med alle policyer scopet til `auth.uid() = user_id`.

## Validator for `structured_data`

`not null default '{}'` gjør tom JSON gyldig for alt. Derfor: én validator i `src/lib/career-atoms-schema.ts`, kalt fra hver skrivevei (import-commit, berikelsesgodkjenning, manuell redigering, konvertering fra rapportoppføring). Skriving uten validering er en feil, ikke et unntak.

Påkrevde felter per `atom_type` (minimum):

| atom_type | Påkrevd | Valgfritt |
|---|---|---|
| `role` | `employer`, `title`, `start` | `end`, `is_current`, `employment_type`, `location`, `orgnr` |
| `achievement` | `statement` | `period`, `role_atom_ref` |
| `metric` | `value`, `unit` | `baseline`, `period`, `method` |
| `context` | `description` | `scope` |
| `tool` | `name` | `level`, `years` |
| `education` | `institution`, `degree` | `field`, `start_year`, `end_year`, `thesis` |
| `skill` | `name` | `level` |
| `domain` | `name` | `years` |
| `language` | `name`, `level` | |
| `certification` | `name`, `issuer` | `issued`, `expires` |
| `project` | `title`, STAR: `situation`, `responsibility`, `actions`, `results_summary` | `company_name`, `industry`, `role_context`, `time_period` |
| `volunteer` | `organization`, `role` | `start`, `end` |

For ikke-evidens: `onske`/`verdi`/`begrensning` krever `dimension`; `begrensning` krever i tillegg `constraint_type` (`geografi`, `reise`, `arbeidstid`, `bransje`, `lonn`, `annet`).

### Styreverv
`employment_type` utvides med `styreleder`, `styremedlem`, `varamedlem`, `nestleder`, `observator`, `radsmedlem`. I `structured_data`: `valgt_fra`, `valgt_til`, `valgperiode_ar`, `gjenvalg` (bool), `honorar_belop`, `honorar_valuta`, `honorar_periode`, samt `orgnr`. `orgnr` er påkrevd for verv — roller er offentlig tilgjengelig per organisasjonsnummer i Brreg, og det er den ene attestasjonskilden som virker uten tredjepart.

### STAR-mapping fra `professional_cases` / `professional_results`
Casen blir ett `project`-atom med STAR i `structured_data`. `results` splittes til `achievement`-barn, og kvantifiserbare tall til `metric`-barn under disse. Casen er kontekst, resultatet er utfall. Begge tabellene er tomme, så dette er en skjemabeslutning uten datamigrasjon.
