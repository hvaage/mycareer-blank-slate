# Aldersgruppe og ESCO-koblet stilling i profilen

## Hva som finnes i dag (verifisert)

- Karrierefase finnes allerede i `user_career_profiles.career_life_phase`, med fire koder og veiledende aldersspenn: Student/nyutdannet (18–25), Tidlig i karrieren (26–35), Etablert karriere (36–50), Senior/erfaren (50+). Den vises på Min profil → Karriereretning og gjenspeiles på Om meg. Den brukes kun som kontekst i aktivitetsforslag.
- Det finnes ingen aldersgruppe som felt. Karrierefasen foreslås i dag ut fra år med erfaring, ikke alder.
- Nåværende stilling finnes som fritekst (`profiles.current_role_title`) uten kobling til ESCO. Det finnes ingen ESCO-referanse noe sted i brukerprofilen.
- Lønnsdata i Markedsinnsikt hentes fra ESCO/SSB-tjenesten med aldersgruppene under 25, 25–29, 30–34, 35–39, 40–44, 45–49, 50–54, 55–59, 60+, kombinert med bransje, utdanningsnivå, sektor og kjønn.

## Det som skal bygges

### 1. Aldersgruppe som eget felt

- Nytt felt `age_group` på `user_career_profiles`, med nøyaktig de samme SSB-intervallene som lønnstjenesten bruker.
- Velges av brukeren på Min profil → Karriereretning, rett over Karrierefase.
- Karrierefase beholdes uendret som eget felt, men forslaget utledes nå fra valgt aldersgruppe i stedet for år med erfaring. Brukeren må fortsatt bekrefte fasen selv; ingenting lagres automatisk.
- Feltet er frivillig, og forklarende tekst sier at det kun brukes til lønnssammenligning og som kontekst i forslag — aldri til å utelukke brukeren.

### 2. Nåværende stilling koblet mot ESCO

- Nye felter på `user_career_profiles`: ESCO-URI, valgt tittel og hvordan den ble valgt (søk eller KI-forslag).
- Ny gjenbrukbar komponent for stillingsvalg:
  - fritekstsøk mot ESCO med autofullføring,
  - knapp «Foreslå stillingsbetegnelse med KI» som tar brukerens tittel, bransje og kort bakgrunn og returnerer 3 kandidater fra ESCO med kort begrunnelse,
  - brukeren bekrefter alltid selv; KI velger aldri på egen hånd, og forslaget merkes synlig som KI-generert.
- Komponenten plasseres på Min profil → Karriereretning for nåværende stilling. `profiles.current_role_title` beholdes og oppdateres med den bekreftede tittelen, slik at Om meg, søknader og selskapsanalyse fungerer som før.

### 3. Lønnsforventning basert på valgt stilling

- Når stilling og aldersgruppe er satt, viser profilen et lønnsbilde fra markedsdataene: median og kvartiler for brukerens aldersgruppe, med bransje fra ESCO-treffet.
- Tallene vises alltid med kilde og periode, i tråd med regelen om at markedstall aldri vises uten kilde.
- Der lønnstjenesten ikke har dekning for kombinasjonen, vises det tydelig i stedet for et estimat.

## Presiseringer fra gjennomgangen

1. **Plassering av stillingsvelgeren.** Komponenten legges i `src/components/career/occupation-picker.tsx` og tar kun inn verdi + callback. Den bruker eksisterende markedsklient og eksisterende UI-komponenter, og importerer ingenting fra profilsidene. Dermed kan «Gap mot målrolle» ta den i bruk senere uten opprydding.
2. **KI-forslaget gjenbruker eksisterende infrastruktur.** Samme oppsett som aktivitetsforslagene: modellprofil hentes fra `internal_ai_get_active_profile`, kallet går gjennom den eksisterende Claude-klienten med prosjektets eksisterende nøkkel, og kjøringen logges i modellkjøringsloggen. Ny profil registreres for oppgaven med `max_tokens` satt lavt (rundt 600), tilpasset tre korte forslag med begrunnelse. Ingen ny leverandør og ingen ny nøkkel.
3. **RLS verifiseres etter migrasjon.** Etter at migrasjonen er kjørt listes faktiske policyer på `user_career_profiles` fra databasen og gjengis i byggerapporten. Ingen antakelser.
4. **Regresjon på `profiles.current_role_title`.** Feltet beholdes som eneste sannhet for fritekst-tittelen. Etter bygging verifiseres Om meg, søknadsgenerering og selskapsanalyse med feltet satt fra den nye velgeren.
5. **Regresjon på karrierefase.** Aldersgruppe gir kun et *forslag* til fase, vist som en knapp brukeren må trykke. En allerede lagret fase overskrives aldri, og ingen eksisterende brukere får endret fase av migrasjonen eller av å velge aldersgruppe.
6. **Tydelig «ingen dekning».** Mangler lønnstjenesten data for kombinasjonen aldersgruppe/bransje, vises en eksplisitt melding om manglende dekning. Aldri tomt tall, aldri estimat.

## Teknisk

- Migrasjon: legg til `age_group text`, `current_occupation_esco_uri text`, `current_occupation_title text`, `current_occupation_source text` på `user_career_profiles`. Ingen nye tabeller, ingen endring i RLS-modellen (tabellen er allerede eierbeskyttet) — verifiseres etter kjøring.
- Ny `src/lib/age-group.ts` med SSB-intervallene, etiketter og mapping aldersgruppe → foreslått karrierefase. `career-life-phase.ts` endres ikke i logikk.
- ESCO-søk går mot den eksisterende markedsklienten (`search_esco_occupations`), som i dag brukes av Markedsinnsikt.
- KI-forslaget kjøres som autentisert server-funksjon som først henter ESCO-kandidater og deretter lar modellen rangere dem. Modellen kan bare velge blant faktiske ESCO-treff, aldri finne på en betegnelse.
- Lønnsbildet bruker eksisterende `get_public_salary_profile` med brukerens aldersgruppe og bransjen fra ESCO-treffet.
- Ingen endringer i Markedsinnsikt-siden, i de sju karrierestadiene eller i matching-/scoringmotoren.

## Avgrensning

Ønsket stilling (målrolle) berøres ikke i denne runden. Samme stillingsvelger kan senere gjenbrukes i «Gap mot målrolle».

## Byggerapport

Rapporten etter bygging inneholder: endrede filer, testresultat for punkt 4–6, og faktisk policyliste for `user_career_profiles`.

