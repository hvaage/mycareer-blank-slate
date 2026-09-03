# Min profil-dashboard og trygg LinkedIn-masseoverføring

## Mål

Gjør «Min profil» til startsiden for hele området «Min karriere», med én tydelig vei videre til redigering og delområder. Rett samtidig LinkedIn-flyten slik at allerede godkjente forslag kan overføres samlet uten ny beslutning per forslag.

## 1. Ny struktur under Min karriere

- Legg «Karriereprofil» (`/min-profil/karriereretning`) synlig i undermenyen under «Min karriere».
- La `/min-profil` være et overordnet, lesbart dashboard – ikke et langt redigeringsskjema.
- Flytt dagens detaljerte «Om meg»-skjema til en egen side for profilopplysninger, med tydelig «Rediger profil»-inngang fra dashboardet.
- Behold gamle adresser som trygge videresendinger der de allerede brukes, slik at eksisterende lenker ikke brytes.
- La profilknappen nederst i sidebaren gå direkte til `/min-profil`, og bruk samme LinkedIn-bildekilde som resten av appen.

## 2. Innhold på Min profil

Dashboardet viser, uten å duplisere redigeringsfeltene:

- LinkedIn-profilbilde, navn, nåværende ESCO-koblede stilling og arbeidsgiver.
- Bransje, karrierestadium, karrierefase og aldersgruppe.
- Lønnsønske og tilgjengelig markedslønn med kilde/periode; tydelig melding hvis markedsdata mangler.
- Viktigste registrerte kompetanser samt antall roller, resultater og kompetanser i karrieregrunnlaget.
- «Sist oppdatert» beregnet fra relevante profil-, karriere- og kildedata.
- Prioriterte forslag til oppdateringer basert på reelle mangler, konflikter og ventende gjennomgang – hver med lenke direkte til riktig arbeidsflate.
- Kompakte innganger til alle delene under «Min karriere»: profilopplysninger, Karriereprofil, Erfaring og kompetanse, Gap mot målrolle, Legg til kilder, Gjennomgå forslag og Min dokumentasjon.

Karriereprofil-siden begrenses til det den eier: aldersgruppe, nåværende ESCO-stilling, karrierefase, karrierestadium og lønnskontekst. Den dupliserte boksen med jobbønsker og kompetanselisten fjernes derfra; disse oppsummeres på dashboardet og redigeres på riktig underside.

## 3. Rett LinkedIn-overføringen ved roten

- Oppdater `linkedin_promote_skill_or_signal` via migrasjon slik at den også leser `label`, bruker eksplisitt `search_path = public, pg_temp`, og dedupliserer normalisert kompetanse mot eksisterende aktive atomer før innsetting.
- Bevar eksisterende godkjenningsbeslutninger. Forslag som kun feilet på den kjente `empty_source_value`-feilen settes tilbake til «Godkjent for overføring» uten at brukeren må godkjenne dem på nytt.
- Lag én autentisert, idempotent masseoperasjon for valgte/godkjente LinkedIn-forslag. Den skal godkjenne bare forslag som fortsatt venter, overføre hvert forslag, registrere «allerede registrert» som et gyldig utfall og returnere konkrete summer uten å stoppe resten ved én feil.
- Ingen atom overskrives, og LinkedIn-innhold forblir importert kildegrunnlag – ikke brukerbekreftet evidens.

## 4. Gjennomgangssiden og tellerne

- Flytt hovedhandlingen «Godkjenn og overfør» til toppen av arbeidslisten; behold fremdrift og resultatsummer synlig der.
- Vis samme handlingskø i innbokstelleren og på kildegjennomgangen: ventende beslutning + godkjent for overføring + eventuelle feil som faktisk kan prøves på nytt.
- Skill tydelig mellom «venter på beslutning», «klar for overføring», «trenger manuell retting» og historiske/ferdige forslag.
- Fjern arbeidsflyten som ber brukeren åpne titalls forslag på nytt etter en teknisk feil. Teknisk retry skjer samlet og beholder tidligere beslutning.
- Invalider både LinkedIn-listen, innbokstelleren og profil-/karrieregrunnlaget etter overføring, slik at tall og dashboard oppdateres med én gang.

## 5. Verifikasjon og byggerapport

- Databasekontroll før/etter: statusfordeling, beslutninger, promoteringshendelser, opprettede atomer og normaliserte dubletter.
- Test at de 92 kjente ferdighetsforslagene kan behandles samlet uten ny beslutning, og at gjentatt kjøring ikke lager dubletter.
- Test at teller på «Gjennomgå forslag» er identisk med den handlingsbare køen på LinkedIn-siden.
- Test desktop og mobil for Min profil, Karriereprofil og Kildegjennomgang, inkludert at hovedhandlingen er synlig før listen.
- Regresjonstest at Om meg-redigering, ESCO-valg, lønnsvisning, karrierestadium/-fase, CV-kø og øvrige Min karriere-lenker fortsatt virker.
- Byggerapporten skal oppgi faktiske før/etter-tall, migrasjonens funksjonsrettigheter/policyrelevante sikkerhet, testresultater og eventuelle forslag som fortsatt krever manuell behandling.
