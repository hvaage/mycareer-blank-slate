# Profilsidene: duplisering, internt vokabular og tall uten grunnlag

## Kartleggingsrapport (målt i koden nå, ingenting endret)

### Hvor skrives feltene

| Opplysning | Om meg skriver til | Karriereprofil skriver til |
|---|---|---|
| År med erfaring | `profiles.years_experience` | `user_career_profiles.years_experience` |
| Ønskede bransjer | `profiles.target_industries` | `user_career_profiles.desired_industries` |
| Ønskede roller | `profiles.target_roles` | `user_career_profiles.desired_role_types` |
| Senioritet | `profiles.target_seniority` | `user_career_profiles.leadership_level` |
| Arbeidsform | `profiles.work_types` | `user_career_profiles.preferred_work_styles` + `remote_preference` + `travel_preference` |
| Lønn min/maks | `profiles.salary_expectation_min/max` | `user_career_profiles.salary_expectation_min/max` |
| Steder | `profiles.preferred_locations` (+ `target_city`, `target_region`) | `user_career_profiles.preferred_locations` |
| Motivasjon | (ingen) | sju skalaer i `user_career_profiles` |

### Hva matching faktisk leser

Fra `score-pending-opportunities` (v3, `loadProfileAndEvidence`):

- **Roller:** union av `profiles.target_roles` + `profiles.target_role` + `user_career_profiles.desired_role_types`. Begge sider teller. To motstridende svar blir ikke valgt mellom — de slås sammen, så «CCO, COO, Daglig leder» og «Utvikling/tech, Produkt» søkes begge.
- **Steder:** union av begge `preferred_locations`.
- **Bransjer:** union av `profiles.target_industries` + `desired_industries`.
- **År med erfaring:** `profiles.years_experience` først, `user_career_profiles` bare som fallback. Karriereprofilens 40 leses aldri når Om meg har 30.
- **Senioritet:** `profiles.target_seniority` først, `leadership_level` som fallback.
- **Hardfilter:** kun `profiles`-felter (`target_city`, `target_region`, `willing_to_relocate`, `preferred_work_extents`, `preferred_engagement_types`).
- **Leses ikke av noe:** lønnsforventning (begge steder), `preferred_company_sizes`, `travel_preference`, `remote_preference`, `preferred_work_styles`, `primary_industry`, alle sju motivasjonsskalaer.

Konklusjon: `profiles` er tabellen matching hviler på. `user_career_profiles` bidrar bare med støy i unionene, og resten av kolonnene der er ubrukte.

### Hva de manuelle skjemaene skriver til

Begge «Legg til for hånd»-skjemaene skriver til **`career_atoms`** (v4), ikke til de droppede tabellene — de feiler altså ikke. Men formen er v3:

- «Dimensjon» + «Viktighet 1–6» → `atom_kind = 'onske'`, `viktighet`. Riktig i v4.
- «Kategori» + «Styrke 1–6» → `atom_kind = 'evidens'`, og styrken skrives til `viktighet`. **Evidens har ingen styrke i v4** — feltet er feilaktig og skal ut.
- Evidens-skjemaet krever allerede peker for kompetanse/eksponering, og kaster forklarende feil når peker mangler. Det beholdes.

## Endringene

### 1. Fjern internt vokabular og tomme seksjoner

- Seksjonen «Match-dimensjoner (forberedelse)» / «Modul 3 (MVP)» / «Lagre utkast til match_assessments» / «White-space» / «Konfidens» fjernes fra Karriereprofil i sin helhet (`PreferencesMatchIntelligenceSection` tas ut av siden).
- «Preferanse-atomer» → «Dette er viktig for deg». «Evidens-atomer» → «Dette kan du dokumentere». (Overskriftene finnes allerede; det er brødtekst, tomtilstander og toast-meldinger som fortsatt sier «atom».)
- «Profilberedskap (lokal)» → «Hvor komplett er profilen din».
- Ingressen «dataene lagres strukturert for neste moduler» og «full vekting i scoring kommer senere» erstattes med én linje per seksjon om hva svaret gir brukeren.

### 2. Fjern tall uten grunnlag

- Beredskapsprosenten vises ikke når brukeren har null registrerte erfaringer/ønsker. I stedet: liste over hva som mangler, i kjedens rekkefølge, med lenke til CV-opplasting.
- Når grunnlaget finnes, teller ikke utfylte skjemafelter alene mot fullstendighet: uten minst én rolle og ett ønske stanser skalaen på «påbegynt».

### 3. Rett de manuelle skjemaene til v4

- «Styrke 1–6» fjernes fra evidensskjemaet, og `strength_score` slutter å skrives.
- «Viktighet 1–6» beholdes for ønsker, med kort forklaring på hva den brukes til.
- Visningen av «Styrke: x/6» på evidenslinjer fjernes.

### 4. Løs dupliseringen — én opplysning, ett sted

Eier = tabellen matching leser, altså `profiles`, redigert fra Om meg. Karriereprofil eier bare det som er unikt for den: karrierestadium og motivasjonsskalaene (de som beholdes).

- Karriereprofil slutter å skrive `years_experience`, `desired_role_types`, `desired_industries`, `leadership_level`, `preferred_locations`, `salary_expectation_min/max`, `preferred_work_styles`. Feltene vises som lesbar oppsummering med «Endre i Om meg».
- Ubrukte felter uten leser fjernes fra skjemaet: `preferred_company_sizes`, `travel_preference`, `remote_preference`, `primary_industry`.
- **Konfliktløser:** der de to tabellene har ulike verdier, vises begge side om side med kilde, og brukeren velger én. Valget skrives til `profiles`, og den tilsvarende kolonnen i `user_career_profiles` tømmes, slik at unionen i matching slutter å blande. Ingen automatisk sammenslåing.
- Konfliktløseren vises bare når det finnes konflikt, og forsvinner når alle er avgjort.

### 5. Måling

Rapporteres etter, for Karriereprofil og Om meg: antall felter før/etter, antall skjermbilder ved 1440 px, antall dupliserte felter, antall forklaringer som beskrev systemet.

## Teknisk

- Frontend: `src/routes/_authenticated/preferences.tsx`, `src/routes/_authenticated/about-me.tsx`, `src/components/career/PreferencesAtomsSection.tsx`, `src/lib/career-profile-completeness.ts`.
- `PreferencesMatchIntelligenceSection.tsx` og tilhørende `whitespace-analysis` / `should-apply`-bruk fjernes fra siden (filene beholdes urørt inntil de eventuelt ryddes senere).
- Konfliktløseren skriver `profiles` og nullstiller de duplikate `user_career_profiles`-kolonnene per bruker. Ingen migrasjon, ingen endring i matching-koden — unionen blir riktig av seg selv når den ene siden er tom.
- Layouttillegget (seksjonsmeny, kolonner, kollaps, tetthet) kommer etter dette, som avtalt.
