# Sluttrapport Fase 4 + ett manuelt ende-til-ende-scenario

## Svar på spørsmålet ditt

Du trenger ikke å laste opp ZIP-filen i chatten. Det enkleste — og det som faktisk beviser det rapporten skal bevise — er at du gjør importen selv i appen, innlogget som deg. Da går alt gjennom den ekte veien: din innlogging, dine tilgangsregler, ditt formålsvalg og din eksplisitte «Legg til»-handling. Laster du opp filen her i stedet, må jeg omgå innloggingen for å lese den, og da tester vi ikke lenger den kjeden som skal godkjennes.

Unntaket: hvis opplastingen i appen feiler, laster du opp ZIP-en her, og jeg feilsøker på filen (struktur, kolonnenavn, tegnsett) uten å skrive til produktdata.

## Hva som skjer i denne runden

Du gjør fire ting i appen (jeg guider underveis):

1. Åpne «Legg til kilder», last opp LinkedIn-eksporten din.
2. Velg formål (f.eks. karriere og nettverk).
3. Åpne «Gjennomgå forslag» og se hva systemet foreslår, med kilde og begrunnelse.
4. Velg **ett** forslag og trykk «Legg til» — én eksplisitt promotering, ikke flere.

Mellom hvert steg leser jeg databasen og noterer nøyaktig hva som ble skrevet, og — like viktig — hva som **ikke** ble rørt.

## Sluttrapporten jeg leverer etterpå

Rapporten skrives som et dokument du kan laste ned, og inneholder:

1. **Migrasjoner** — kronologisk liste over alle migrasjoner i Fase 1–4, med hva hver enkelt innfører.
2. **Nye produktmodeller** — hvilke tabeller LinkedIn-import kan skrive til, hvilke felter, og hvilke eksisterende modeller som gjenbrukes fremfor å dupliseres.
3. **RLS og grants** — faktisk uttrekk fra databasen per tabell: er radsikkerhet på, hvilke regler gjelder, hvilke roller har hvilke rettigheter. Ikke gjengivelse av hva som var tenkt, men hva som står der nå.
4. **Kontraktdiff** — forskjellen mellom importkontrakten (`docs/linkedin-import-contract-v1.md`) og det som faktisk ble funnet i din ekte eksport: filer vi forventet og ikke fant, filer vi ikke kjente igjen, kolonner som har endret navn hos LinkedIn.
5. **Ende-til-ende-scenariet** — sporet for den ene promoteringen din, steg for steg: kildefil og rad, forslag, din beslutning, produktraden som ble opprettet, hendelsen i revisjonsloggen.
6. **Før/etter-tellinger** — radtellinger på alle berørte produkttabeller før og etter, som viser at kun det ene du godkjente ble lagt til.
7. **Avvik og åpne punkter** — alt som ikke oppførte seg som ventet, uten pynt.

## Grenser for denne runden

- Ingenting promoteres automatisk. Kun det ene forslaget du selv godkjenner.
- Ingen kodeendringer med mindre noe faktisk feiler; da rapporterer jeg først og retter etter din beslutning.
- Fase 5 startes ikke.

## Teknisk

- Observasjon skjer med leseforespørsler mot `linkedin_imports`, `linkedin_import_files`, `linkedin_staging_records`, `linkedin_reconciliation_runs/_proposals/_decisions`, `linkedin_promotion_events`, `linkedin_promotion_targets`, samt produkttabellene (`career_atoms`, `career_recommendations`, `network_contacts`, `user_career_profiles`).
- RLS/grants hentes fra `pg_policies` og `information_schema.role_table_grants` per tabell.
- Kontraktdiff bygges ved å sammenligne `linkedin_import_files` og klassifiseringsutfallet mot filmanifestet i kontraktdokumentet.
- Rapporten legges i `/mnt/documents` som markdown, med tellinger og policy-uttrekk inline.
