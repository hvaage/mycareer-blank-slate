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

Nytt felt på karriereprofilen med fire valg:

- Student eller nyutdannet (18–25)
- Tidlig i karrieren (26–35)
- Etablert karriere (36–50)
- Senior / erfaren (50+)

Lagres som en kode (ikke fritekst), med databasesjekk på gyldige verdier. Kun brukeren selv kan lese og skrive sin egen rad — samme regler som resten av karriereprofilen.

### 2. Min profil → Karriereretning

Seksjonen «Karrierestadium i dag» utvides med den nye karrierefasen som første spørsmål, med kort forklaring: fasen styrer hvilke nettverksaktiviteter som foreslås, karrierestadiet styrer hvordan stillinger vektes. Ingen av dem er påkrevd.

Når feltet er tomt, foreslås en fase automatisk ut fra `years_experience` som forhåndsvalg brukeren selv må bekrefte — aldri lagret uten bekreftelse.

### 3. Om meg → visning

Den lille linjen «Karrierestadium i dag: …» på Om meg viser også valgt karrierefase, med samme «endre»-lenke.

### 4. Aktivitetsforslag bruker fasen

Forslagsmotoren for Nettverksarbeid → Aktiviteter får karrierefasen inn i grunnlaget, sammen med det som allerede sendes. Hver fase får en kort, konkret føring for hva slags nettverksarbeid som passer:

- Student/nyutdannet: bygge første nettverk, faglige miljøer, alumni, hospitering, åpne henvendelser.
- Tidlig i karrieren: synlighet i fagmiljø, mentor, målrettede kaffeprater, første lederkontakter.
- Etablert karriere: beslutningstakere og fagfeller på eget nivå, gjensidig verdi, styrking av eget omdømme.
- Senior/erfaren: tette relasjoner høyt i organisasjoner, styre-/rådgiverspor, aldersnøytral posisjonering med vekt på resultat og mandat.

Forslagene skal fortsatt aldri opprette aktiviteter eller kontakte noen automatisk. Alder brukes til å tilpasse type og tone på forslag — aldri som utelukkelseskriterium.

## Teknisk

- Migrasjon: `career_life_phase text` på `public.user_career_profiles` med `CHECK` mot de fire kodene (`student_nyutdannet`, `tidlig_karriere`, `etablert_karriere`, `senior_erfaren`). Ingen nye tabeller, ingen nye grants nødvendig utover det tabellen har.
- Ny modul `src/lib/career-life-phase.ts` med koder, norske etiketter, aldersspenn og forslagsføringer — samme form som `career-stage.ts`.
- UI: `src/routes/_authenticated/min-profil/karriereretning.tsx` (nytt Select over eksisterende karrierestadium) og `src/components/pages/about-me-page.tsx` (visning).
- Forslagskjøreren `src/routes/api/public/jobs/network-suggestions.ts` leser feltet og legger faseføringen inn i prompten. Ingen endring i jobbmodell eller kjøremønster.
- Ingen endring i `career-stage.ts`, matchdimensjoner eller scoringsversjon.

## Utenfor omfanget

Selve utvidelsen av Nettverksarbeid → Aktiviteter (nye aktivitetstyper, flater, arbeidsflyt) kommer som neste steg. Dette er grunnlaget den bygger på.
