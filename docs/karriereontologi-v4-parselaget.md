# Parselaget — `public.cv_parse_candidates` (fase 2.3)

Prosjektreferanse: `miwzhbludgwvskmsfqnq`. Status: skjemaforslag, migrasjon ikke kjørt.

Erstatter `public.cv_evidence_atoms`. Navnet sier hva raden er: et parseresultat,
ikke evidens. Evidens finnes kun i `career_atoms`, og oppstår først når brukeren
har bekreftet kandidaten i gjennomgangen.

Begge tabellene (`cv_evidence_atoms`, `cv_imports`) har null rader. Rename uten
datamigrering.

## Kolonner

### Identitet og tilhørighet
| Kolonne | Type | Merknad |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `user_id` | uuid not null | FK `auth.users` on delete cascade |
| `import_id` | uuid not null | FK `cv_imports` on delete cascade. Ny. Hver kandidat tilhører én import. |
| `local_ref` | text not null | Parserens egen id innenfor importen |
| `parent_local_ref` | text | Struktur innenfor parsen (achievement under role) uten self-FK til atomer |

`parent_atom_id` er fjernet. Rolletrær finnes fortsatt i parsen, men som
tekstreferanser innenfor én import — ikke som en atomgraf.

### Innhold og forslag
| Kolonne | Type | Merknad |
|---|---|---|
| `suggested_atom_type` | text not null | Parserens forslag, v4-vokabular |
| `resolved_atom_type` | text | Brukerens valg i gjennomgangen. Null til den er behandlet. |
| `content_no`, `content_en` | text | |
| `structured_data` | jsonb not null default `'{}'` | Beholdes |
| `dedupe_key` | text | Dedup innenfor og mellom importer, før gjennomgang |

`atom_type` er splittet i forslag og avgjørelse, fordi forskjellen mellom dem er
selve gjennomgangen. Blir de ett felt, kan vi ikke se hva parseren trodde.

### Sporing i kilden
`source_type` (not null), `source_ref`, `source_quote`. Uendret. Dette er det
parselaget skal bære.

### Parserens egen sikkerhet
| Kolonne | Type | Merknad |
|---|---|---|
| `parse_confidence` | numeric(3,2) | 0–1, hvor sikker parsen er på uttrekket |

`confidence` er fjernet. Den er v4s opprinnelsesakse (`imported`/`inferred`/
`verified`) og hører til `career_atoms`. Parsen har ikke en opprinnelse — den
*er* opprinnelsen.

### Behandlingstilstand
| Kolonne | Type | Merknad |
|---|---|---|
| `status` | text not null default `'ubehandlet'` | `ubehandlet`, `bekreftet`, `avvist`, `ble_sporsmal` |
| `promoted_atom_id` | uuid | FK `career_atoms` on delete set null. Hva bekreftelsen ble til. |
| `question_ref` | text | Peker til spørsmålet når status er `ble_sporsmal` |
| `rejected_reason` | text | Fritekst, valgfri |
| `reviewed_at` | timestamptz | |
| `created_at`, `updated_at` | timestamptz not null | trigger på updated_at |

Avviste kandidater blir stående med `status='avvist'`. Ingenting slettes ved
gjennomgang.

## Fjernet fra dagens tabell
`attestation` (fantes ikke som kolonne, kun i typene), `user_confirmed`,
`user_locked`, `parent_atom_id`, `evidence_atom_ids` (fantes kun inni
`structured_data.skill`), `canonical_atom_id`, `evidence_scope`,
`career_stage_relevance`, `role_relevance_tags`, `relevance_score`,
`last_seen_at`, `confidence`.

`relevance_score` fjernes fordi v4 slår fast at evidens ikke har tallvekt.
De tre `*_relevance`-kolonnene er tolkning, ikke parseresultat.

## Constraints
1. `status` in (`ubehandlet`, `bekreftet`, `avvist`, `ble_sporsmal`).
2. `suggested_atom_type` og `resolved_atom_type` i v4-vokabularet for evidens.
3. `promoted_atom_id` not null når `status='bekreftet'` — trigger, ikke CHECK.
4. `resolved_atom_type` not null når `status='bekreftet'`.
5. `unique (import_id, local_ref)`.

Parselaget har med vilje *ingen* av ontologi-constraintene fra `career_atoms`.
Rå maskinlesning kan ikke oppfylle dem. Det er hele poenget med to lag.

## Indekser
`(user_id, status)`, `(import_id)`, `(user_id, dedupe_key)`, `(promoted_atom_id)`.

## Tilgang
GRANT select/insert/update/delete til `authenticated`, ALL til `service_role`,
ingen `anon`. RLS med alle policyer scopet til `auth.uid() = user_id`.

## Typekart fra parserens `category`
Parseren foreslår, gjennomgangen avgjør.

| `category` | `suggested_atom_type` | Gjennomgang |
|---|---|---|
| `technical`, `soft`, `methodology` | `skill` | Krever evidenspeker, ellers spørsmål |
| `tool` | `tool` | Direkte |
| `language` | `language` | Direkte |
| `domain` | `domain` | Krever at brukeren velger rolle |
| `leadership` | `skill` | Vis personalansvar fra rollen der det finnes |
| `other` | null | Alltid spørsmål til bruker |
