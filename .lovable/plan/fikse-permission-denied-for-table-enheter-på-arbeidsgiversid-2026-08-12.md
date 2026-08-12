# Fikse "permission denied for table enheter" på arbeidsgiversiden

## Hva jeg fant (verifisert mot databasen)

Feilen har ingenting med secrets å gjøre. Den kommer av manglende leserettigheter:

- Arbeidsgiver-detaljsiden (`/arbeidsgivere/<orgnr>`) leser direkte fra visningen `public.employer_search_v1`.
- Den visningen er satt opp med `security_invoker=true`, altså kjører den med den innloggede/anonyme brukerens rettigheter.
- Verken anonyme eller innloggede brukere har tilgang til registerdataene bak visningen (`reg`-skjemaet): ingen tilgang til skjemaet, ingen leserett på tabellene. Derfor: `permission denied for table enheter`.
- Visningen `employer_search_v1` har heller ingen leserett gitt til anonyme/innloggede brukere.
- Det finnes allerede en trygg databasefunksjon `public.get_employer_detail(orgnr)` som kjører med forhøyede rettigheter og henter nøyaktig samme data — men frontend bruker den ikke.
- Samme mønster gjelder søket: `public.search_employers` er kun tilgjengelig for innloggede brukere, ikke for anonyme besøkende. Arbeidsgiversøket vil altså også feile utlogget.

## Foreslått løsning

1. Endre detaljhentingen i `src/lib/queries/employer-insight.ts` fra direkte spørring mot visningen til kall på `get_employer_detail`-funksjonen. Feilhåndtering (ikke funnet / utilgjengelig) beholdes som i dag.
2. Kjør én migrasjon som gir anonyme besøkende kjøretilgang til `get_employer_detail` og `search_employers`, slik at den offentlige arbeidsgiversiden fungerer uten innlogging. Ingen direkte tilgang til `reg`-skjemaet åpnes — all lesing går fortsatt gjennom de kontrollerte funksjonene som kun eksponerer offentlige registerdata.
3. Ingen endring i `reg`-tabellene, ingen ny RLS-policy, ingen endring i visningen (den blir liggende, men brukes ikke lenger av detaljsiden).

## Verifisering

- Åpne `/arbeidsgivere/923609016` (Equinor) utlogget og innlogget: registerpanel og regnskapstall skal vises uten feilmelding.
- Kjør arbeidsgiversøket utlogget og bekreft at treff vises.
- Bekreft i databasen at `reg`-skjemaet fortsatt ikke er direkte lesbart for anonyme/innloggede roller.

## Teknisk

- Frontend: `loadEmployerDetail()` bytter fra `.from("employer_search_v1").select("*").eq(...)` til `.rpc("get_employer_detail", { p_organisasjonsnummer: orgnr })`, med samme returkontrakt (`ok` / `not_found` / `unavailable`).
- Migrasjon: `GRANT EXECUTE ON FUNCTION public.get_employer_detail(text) TO anon;` og `GRANT EXECUTE ON FUNCTION public.search_employers(...) TO anon;` (begge er allerede `SECURITY DEFINER` med `search_path` satt).

## Risiko og bivirkninger

Lav risiko. Vurdert punkt for punkt:

- **Datainnhold blir identisk.** Funksjonen `get_employer_detail` returnerer nøyaktig samme kolonnesett som visningen siden (den er definert som `SETOF employer_search_v1`). UI-feltene trenger ingen endring.
- **Åpner vi noe for mye?** Anonyme får kun kjøre to funksjoner som allerede er skrevet for offentlig registerinnsikt (Brreg-data som er offentlig tilgjengelig). De får ikke tilgang til `reg`-skjemaet, ingen brukerdata, ingen skriverettigheter. Søket har allerede en øvre grense på antall treff per kall.
- **Skraping/last:** offentlig søk uten innlogging kan gi noe mer trafikk mot databasen. Kan avgrenses senere med rate-limit hvis det blir et problem — ikke nødvendig nå.
- **Sikkerhetsskanner:** `SECURITY DEFINER`-funksjoner med anon-tilgang kan bli flagget i skann. Det er et bevisst valg her og bør noteres i sikkerhetsminnet.
- **Alternativ hvis dere heller vil holde arbeidsgiversidene bak innlogging:** da dropper vi anon-grantene helt og gjør kun frontend-byttet. Da fungerer sidene for innloggede, og utloggede får en «logg inn»-melding i stedet for feil.
- **Rulles enkelt tilbake:** frontend-endringen er noen få linjer, og grantene kan trekkes tilbake med én setning.

## Tidsbruk

Cirka 15–25 minutter totalt: frontend-bytte (~5 min), migrasjon med grants (~5 min), verifisering utlogget/innlogget på detalj- og søkeside (~10 min).
