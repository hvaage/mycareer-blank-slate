# Jobb-leads: tre valg, annonsetekst inn i søknaden og selskapsmatching

## Bakgrunn (verifisert nå)

- Søknadssiden viser «Stillingsannonse» fra tabellen `job_ads`, koblet til søknaden. Spørring mot databasen: GlobalConnect har én `job_ads`-rad (importert manuelt via «Importer annonse»), mens Medbric, People Oslo Vest og ALT LEGALT har null. Promotering fra Jobb-leads oppretter aldri `job_ads` — derfor mangler annonseteksten for alle unntatt GlobalConnect. Dette er ikke en parse-feil.
- Ingen av søknadene har `company_id` satt. Promotering kobler ikke mot arbeidsgiverregisteret i dag.
- Avstemmingsmotoren (`network_company_reconciliation_scan`) leser allerede observasjoner fra `user_opportunities` og kontaktrelasjoner, men **ikke** fra `applications`.
- Jobb-leads-kortet har i dag: «Flytt til søknader», «Avvis» og «Skriv søknad». Det finnes ingen «Flytt til muligheter».
- `user_opportunities` krever `canonical_opportunity_id` (NOT NULL) og `identity_fingerprint`, så et lead fra e-post/manuell/LinkedIn/Finn må få en kanonisk mulighet opprettet før det kan vises under Muligheter. Funksjonen `opportunity_fingerprint(company, title, location)` finnes allerede.

## Det som skal bygges

### 1. Annonseteksten følger med til Søknader
Ved promotering opprettes en `job_ads`-rad for søknaden, med beste tilgjengelige kilde i denne rekkefølgen:
1. `raw_payload.extracted` (manuelle importer: `ad_markdown`, `about_role`, `about_company`, `ideal_candidate`, `must_have_keywords`, `key_requirements`, `nice_to_have`, frist),
2. full annonsetekst fra `job_leads.raw_snippet` / e-postens lagrede tekst,
3. ingen rad hvis det ikke finnes reell annonsetekst (da vises dagens tomtilstand med importknappen).

Frist, URL, selskap, rolle, sted og arbeidsform speiles inn i `parsed_*`-feltene. Eksisterende manuell import overskrives aldri.

Etterfylling: for de tre søknadene som allerede er flyttet uten annonse (Medbric ×2, People Oslo Vest, ALT LEGALT) opprettes `job_ads` fra teksten som fortsatt ligger på søknaden/leadet, der tekst finnes.

### 2. Tre valg på hvert jobb-lead
Knapperaden blir: **Flytt til søknader**, **Flytt til muligheter**, **Avvis** (og «Skriv søknad» beholdes som primærhandling helt til høyre, siden den er en snarvei til samme flyt pluss søknadsteksten).

«Flytt til muligheter» oppretter/gjenbruker en kanonisk mulighet og en `user_opportunities`-rad med en valgt status (ikke `new`), slik at den dukker opp under Nettverksarbeid → Muligheter og ikke lenger ligger i Jobb-leads. Score, screening-status, begrunnelse og frist følger med. For Careerjet/NAV-leads, som allerede *er* `user_opportunities`, settes bare status til valgt — ingen duplikater.

### 3. Selskapsmatching mot arbeidsgiverregisteret ved begge flyttinger
Når et lead flyttes til søknader eller muligheter:
- selskapsnavnet avstemmes mot registerspeilet via den eksisterende avstemmingsmotoren,
- ved sikkert treff settes `company_id` på søknaden/mulighetsraden og selskapet legges til brukerens aktive selskaper (`user_company_relationships`), slik at det vises under Nettverksarbeid → Selskaper med kontakter og aktiviteter,
- ved flere eller ingen treff får brukeren opp en liten dialog der søkenavnet kan justeres (f.eks. fjerne avdeling, suffiks eller land), med treffliste fra registeret som oppdateres mens navnet endres, og valg av riktig selskap derfra. Alternativet i samme dialog er «Opprett uten matching», med en kort forklaring av hva det innebærer: søknaden/muligheten lagres med selskapsnavnet som tekst, uten organisasjonsnummer, uten registerdata og uten kobling til Nettverksarbeid → Selskaper; koblingen kan gjøres senere.

Avstemmingsmotoren utvides til også å lese `applications` som observasjonskilde, slik at søknader får samme selskapsidentitet som muligheter.

### 4. Kvalitetssjekk før og etter
Før-tilstand er allerede målt (antall søknader, `job_ads`-rader, `company_id`-dekning, antall muligheter per status). Etter endringen kjøres nøyaktig samme spørringer på nytt, pluss en gjennomgang i appen av: Jobb-leads (tre valg virker, raden forsvinner umiddelbart), Søknader (annonsetekst synlig), Muligheter (kun valgte rader), Nettverksarbeid → Selskaper (nytt selskap koblet). Alt utenfor disse fire områdene skal være uendret; det bekreftes ved at ingen andre spørringer/tellinger endrer seg.

## Teknisk

- Skriveveiene legges i en server-funksjon per handling (`promoteJobLeadToApplication`, `promoteJobLeadToOpportunity`) med `requireSupabaseAuth`, slik at klienten ikke setter `user_id` og all logikk (job_ads, kanonisk mulighet, selskapskobling, dedupe-merking) skjer i én operasjon.
- Ny/endret databasefunksjonalitet leveres som migrasjon: utvidet `network_company_reconciliation_scan` med `application`-observasjoner, og en SECURITY DEFINER-funksjon for å opprette kanonisk mulighet + `user_opportunities`-rad fra et `job_leads`-id. Begge med eksplisitt `search_path` og REVOKE/GRANT etter gjeldende sikkerhetsregler.
- `applications` får `company_id` satt der det ikke allerede er i bruk; kolonnen finnes.
- Frontend-endringer begrenses til `src/routes/_authenticated/job-leads.tsx` (knapperad + handlinger) og invalidering av berørte query-nøkler.
