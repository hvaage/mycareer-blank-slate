# Korrigering av produktkontrakten til v1.1

Kun `docs/network-opportunities-product-contract-v1.md` endres. Ingen migrasjon, ingen kode, ingen UI.

## 1. Kildeklasse per verdi (§0.1, alle feltkontrakter)

- Hver aktiv feltverdi har nøyaktig én `source_class`. Skrivemåter som «linkedin_observation / user_input» fjernes fra alle tabeller i §2.2, §3.2, §4.2, §5.1.
- Ved manuell redigering blir aktiv verdi `user_input`; forrige LinkedIn-observasjon beholdes som historisk proveniens.
- DTO-en utvides slik at aktiv verdi og siste LinkedIn-observasjon vises hver for seg og aldri blandes:
  `{ state, value?, source_class, observed_at?, imported_at?, analyzed_at?, last_source_observation?: { source_class: 'linkedin_observation', value, observed_at } }`.
- UI-regel: når aktiv verdi er `user_input` og en avvikende LinkedIn-observasjon finnes, vises den som sekundær «sist observert i LinkedIn»-linje, ikke som feltverdi.

## 2. Utvidet SourceClass (§0.1)

Legges til: `job_posting`, `derived_evaluation`, `ai_suggestion`.

- Kontaktperson hentet fra annonse: `job_posting` (ikke `linkedin_observation`).
- Preferanse- og kompetansematch på Mulighet: `derived_evaluation`, med obligatorisk modell-/regelversjon og inputtidspunkt i DTO-en.
- KI-genererte aktivitetsforslag: `ai_suggestion` (ikke `employer_analysis`), og krever alltid brukerhandling før de blir aktiviteter.

## 3. Kontakt kontra kompetansesignal (§3.1, §3.2, §0.4)

- Endorsement-signal fjernes helt fra Kontakt-flaten og fra Kontakt-minimumsmodellen.
- Aggregert LinkedIn-støtte vises kun ved brukerens egen kompetanse i Min profil.
- Ingen endorseridentitet lagres eller vises — presiseres i §0.4.
- Datamatrisen (§6): rad «Endorsement-signal» får UI-flate kun «Min profil (aggregert)».

## 4. Anbefalinger (§3.3)

- Mottatte anbefalinger hører hjemme i Min profil / Min dokumentasjon.
- De kan vises på en kontaktside kun ved eksplisitt, brukerbekreftet kobling til `network_contact`. Navnelikhet er aldri tilstrekkelig og skal ikke gi automatisk kobling eller forslag med automatisk godkjenning.

## 5. Identitetsmodell (§3.2, §8)

- `network_contact_identities` er eneste kanoniske eier av LinkedIn-profil-URL.
- Kravet om `profile_url`-kolonne på `network_contacts` fjernes fra kontrakten og fra avvikslisten i §8.
- `last_observed_at` beholdes på `network_contacts`; URL relateres gjennom identity-tabellen.

## 6. Brukerens relasjon til selskap (§2.2, §8)

- Notater, status og prioritet for selskap eies av en user-scoped tabell `user_company_relationships`. Ingen brukerdata lagres på delte `companies`.
- Kontrakten navngir tabellen eksplisitt, og §8 får et nytt skjemaavvik: tabellen finnes ikke og må opprettes i Leveranse B med RLS på `user_id`.

## 7. Innhold/artikler (§6)

Matriseraden endres til:

```text
LinkedIn Articles/Shares -> linkedin_content_staging -> forslag -> not_actionable_in_phase_4 -> ingen produktflate ennå
```

Artikler promoteres ikke til `documents` før en proveniensbevarende porteføljemodell er spesifisert og godkjent.

## 8. Aktivitetsmigrering (nytt underkapittel i §8)

Sikker migrering av `next_steps`, i denne rekkefølgen:

1. Legg til `user_id`, `activity_kind`, `contact_id`, `company_id`, `opportunity_id` som nullable.
2. Backfill `user_id` fra eksisterende `application_id`-relasjon.
3. Valider backfill (null-telling må være 0) før neste steg.
4. Gjør `application_id` nullable først etter validert backfill.
5. Legg til FK-er og RLS-policyer for `contact_id`, `company_id`, `opportunity_id`, samt user-scoped policyer på `user_id`.
6. Eksisterende søknadsrelaterte aktiviteter forblir uendret i innhold og synlighet.

## Leveranse

Oppdatert dokument merkes v1.1 med endringslogg øverst. Deretter stopp for godkjenning før Leveranse A.
