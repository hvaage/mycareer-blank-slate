# Aldersgruppe / karrierefase — grunnlag for bedre aktivitetsforslag

## Utgangspunkt (verifisert)

- `public.profiles` finnes og er koblet til brukerkontoen. Ingen alders- eller fødselsårsfelt finnes.
- Yrke og retning finnes allerede og skal gjenbrukes, ikke dupliseres: `current_role_title`, `current_employer`, `years_experience`, `target_roles`, `target_seniority`, `target_industries` på profilen, og `career_stage`, `leadership_level`, `desired_role_types`, `desired_industries` på karriereprofilen.
- «Karrierestadium i dag» ligger på Min profil → Karriereretning og har i dag 7 alternativer: Student, Tidlig i karrieren, Midtkarriere, Senior spesialist, Senior leder, Ledelse (executive), Gründer.
- Rutene `/nettverk/...` med Aktiviteter og «Få aktivitetsforslag» finnes.
- `ANTHROPIC_API_KEY` finnes. Aktivitetsforslag kjøres i dag fra en intern jobbrute, ikke en egen edge function — samme mønster gjenbrukes.

## Viktig avklaring om «juster karrierestadium»

De 7 stadiene er ikke bare en etikett: de styrer prioriteringsrekkefølgen på matchdimensjonene og UI-hint i profil- og matchlogikken. Å erstatte dem med fire aldersbånd ville endret matchingen for alle brukere — det ligger utenfor det du har bedt om.

I stedet: de 7 stadiene beholdes som i dag, og det legges til ett nytt, tydelig aldersbasert felt rett ved siden av, i samme seksjon. Da spør vi brukeren om nøyaktig de fire gruppene du oppga, uten å røre matchingen.

## Det som bygges

### 1. Nytt felt: karrierefase (aldersbasert)

Ny kolonne `career_life_phase` på `public.user_career_profiles` med `CHECK` på fire koder:

| Kode | Etikett | Alder | Føring for nettverksforslag |
|---|---|---|---|
| `student_nyutdannet` | Student eller nyutdannet | 18–25 | Bygge første nettverk, faglige miljøer, alumni, hospitering, åpne henvendelser. |
| `tidlig_karriere` | Tidlig i karrieren | 26–35 | Synlighet i fagmiljø, mentor, målrettede kaffeprater, første lederkontakter. |
| `etablert_karriere` | Etablert karriere | 36–50 | Beslutningstakere og fagfeller på eget nivå, gjensidig verdi, styrking av eget omdømme. |
| `senior_erfaren` | Senior / erfaren | 50+ | Tette relasjoner høyt i organisasjoner, styre-/rådgiverspor, aldersnøytral posisjonering med vekt på resultat og mandat. |

Ingen nye tabeller og ingen nye grants. Eksisterende eier-policy på tabellen dekker den nye kolonnen automatisk; dette bekreftes mot databasen etter migrasjonen. Eksisterende rader får `null`.

### 2. Min profil → Karriereretning

Karrierefase legges inn som første spørsmål i seksjonen «Karrierestadium i dag», over det eksisterende valget, med felles forklaring: «Karrierefasen styrer hvilke nettverksaktiviteter som foreslås. Karrierestadiet styrer hvordan stillinger vektes.»

Begge felt er valgfrie. Er karrierefase tom og `years_experience` finnes, vises et forhåndsvalg utledet av erfaring, tydelig merket «Foreslått ut fra din erfaring — bekreft eller endre». Forslaget lagres aldri av seg selv; feltet forblir `null` i databasen til brukeren aktivt velger og lagrer.

Foreslåtte grenser i `suggestCareerLifePhase(yearsExperience)`: 0–3 år → student/nyutdannet, 4–13 → tidlig, 14–28 → etablert, 29+ → senior.

### 3. Om meg → visning

Linjen som i dag viser «Karrierestadium i dag: …» viser også valgt karrierefase, samme stil og samme «endre»-lenke. Er feltet tomt, vises ingenting ekstra.

### 4. Aktivitetsforslag bruker fasen

Forslagskjøreren leser `career_life_phase` sammen med det som allerede hentes. Er feltet satt, legges føringsteksten for fasen inn i prompten som ekstra kontekst. Er det ikke satt, er prompten identisk med dagens. Ingen endring i jobbmodell, trigger, kjøreplan eller utdataformat.

Karrierefase brukes kun til å tilpasse type og tone på forslag — aldri til å ekskludere brukeren eller filtrere bort forslagstyper. Forslag oppretter fortsatt aldri aktiviteter og kontakter aldri noen automatisk.

## Teknisk

- Migrasjon: `alter table public.user_career_profiles add column if not exists career_life_phase text check (...)` med de fire kodene.
- Ny modul `src/lib/career-life-phase.ts`: koder, etiketter, aldersspenn, føringstekster og `suggestCareerLifePhase`. Samme form som `career-stage.ts`.
- UI: `src/routes/_authenticated/min-profil/karriereretning.tsx` og `src/components/pages/about-me-page.tsx`.
- Prompt: `src/routes/api/public/jobs/network-suggestions.ts` (og forslagskjøreren den kaller).
- Ingen nye npm-pakker.

## Verifikasjon

- Spørring mot databasen: kolonne finnes, CHECK er aktiv, ugyldig verdi avvises, eksisterende rader er `null`.
- Diff bekrefter at `career-stage.ts`, matchdimensjoner og scoringsversjon er urørt.
- UI-sjekk i kjørende app: forhåndsvalg vises som forslag, lagring uten valg lar feltet forbli `null`, Om meg viser fasen etter lagring.
- Promptgrunnlaget kontrolleres for både bruker med og uten feltet satt.

## Utenfor omfanget

Selve utvidelsen av Nettverksarbeid → Aktiviteter (nye aktivitetstyper, flater, arbeidsflyt) kommer som neste steg. De 7 karrierestadiene beholdes uendret i antall, rekkefølge og logikk.

