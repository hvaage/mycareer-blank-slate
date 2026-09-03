# Personlig gap-analyse: hvorfor den aldri kjører, og hva som skal til

## Oppgave 1 — funn (verifisert, ingen endringer gjort)

**Hvem er ment å skrive?** Én eneste skrivevei finnes: `persistPreferencesMatchDraft()` i `src/lib/queries/match-assessments.ts`. Den skriver header til `match_assessments`, rader til `match_dimension_assessments` og `positioning_recommendations`. Det finnes ingen cron-jobb, ingen Edge Function og ingen databasetrigger som skriver til disse tabellene.

**Er den koblet til noe?** Funksjonen kalles kun fra `src/components/career/PreferencesMatchIntelligenceSection.tsx` (knappen «Lagre utkast til match_assessments»). Søk i `src/routes` viser at denne komponenten ikke rendres av noen side. Den er altså frakoblet kode — knappen finnes ikke i produktet noe sted.

**Hvorfor har ingen testbruker trigget den?** Fordi UI-et ikke er nåbart. Det er ingen manglende forhåndsbetingelse på data: 78 `career_atoms` (77 brukerbekreftet) og 163 `opportunity_requirement_atoms` finnes. Alle tre måltabellene har 0 rader.

**Er den 90 % ferdig?** Nei. Skjema, spørringer og en UI-skisse finnes, men selve gap-analysen mangler:
- komponenten kaller `analyzeWhitespace(...)` med `jobOrCompanyRequirements: []` hardkodet — den sammenligner aldri mot en målrolle
- `missing_evidence_atoms` skrives alltid som tom liste, så det sentrale feltet «hva mangler du» produseres ikke
- det finnes ingen målrollevalg, ingen kobling til ESCO-rollesøket, og status settes alltid til `draft`

Konklusjon: dette er et påbegynt fundament (tabeller + lesespørringer + demo-komponent) som ble lagt til side før den faktiske sammenligningen mot en målrolle ble bygget. Riktig grep er å fullføre her, ikke starte et fjerde forsøk.

## Oppgave 2 — forslag til avgrenset ferdigstilling

Mål: innlogget bruker velger en målrolle med samme ESCO-søk som Markedsinnsikt, og får en reell `match_assessment` med utfylte `missing_evidence_atoms`.

1. **Målrollevalg**: gjenbruk `search_esco_occupations` (samme RPC som `CareerExplorer` bruker mot ESCO-prosjektet) i en enkel rollevelger. Valgt rolle lagres som kontekst på analysen (rolle-URI + tittel i `reasoning`).
2. **Kravgrunnlag**: hent kompetansekravene for valgt rolle fra ESCO-siden (samme kilde som Markedsinnsikt allerede leser), og send dem inn som `jobOrCompanyRequirements` til `analyzeWhitespace` — i dag det eneste manglende inputet.
3. **Gap-beregning**: fyll `missing_evidence_atoms` per dimensjon (krav uten treff i brukerens bekreftede `career_atoms`), og behold matchede preferanse-/evidensatomer som i dag.
4. **Skrivevei**: flytt skrivingen til en server-funksjon med autentisering i stedet for direkte klient-insert, sett `status = "completed"` og lagre målrolle + kildeversjon slik at analyser kan sammenlignes over tid.
5. **Plassering i UI**: én synlig inngang på Min karriere («Gap mot målrolle») som viser samlet score, per-dimensjon gap og de konkrete manglene — og lagrer resultatet.
6. **Personvern/regler**: kun brukerbekreftet evidens (`user_confirmed = true`) brukes; alt KI-/avledet innhold merkes; ingen påstand uten sporbarhet til et atom.

Ikke i omfang: Markedsinnsikt-siden røres ikke, og ingen ny AI-modell innføres i dette trinnet — analysen er deterministisk.

## Teknisk

- Berørte filer ved bygging: `src/lib/queries/match-assessments.ts`, `src/lib/whitespace-analysis.ts`, `src/components/career/PreferencesMatchIntelligenceSection.tsx` (eller erstatning), ny server-funksjon, én rute/seksjon under Min karriere.
- Ingen skjemaendring nødvendig i første omgang; eventuelt én kolonne for målrolle dersom vi ikke vil legge den i `reasoning`.
- Ingen migrasjon og ingen kode i denne runden.
