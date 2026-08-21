# Fase 5A — Nettverk og muligheter: grunnflate og nettverksregister

Leveransen dekker modulnavigasjon, globalt søk, importstatus, Selskaper og Kontakter. Oversikt, Muligheter og Aktiviteter bygges ikke i denne runden. Stopp for gjennomgang før 5B.

## Navigasjon og modulskall

- Ny gruppe **Nettverk og muligheter** i sidemenyen under **Min karriere**, plassert før **Marked**.
- Rutetre under `/nettverk`:

```text
/nettverk/oversikt      (5B — plassholder med tydelig «bygges i neste leveranse»)
/nettverk/selskaper     liste
/nettverk/selskaper/$id detalj
/nettverk/kontakter     liste
/nettverk/kontakter/$id detalj
/nettverk/muligheter    (5B — plassholder)
/nettverk/aktiviteter   (5B — plassholder)
```

- Fast sekundærnavigasjon i modulens topplinje: Oversikt | Selskaper | Kontakter | Muligheter | Aktiviteter. Flater som ikke er bygget markeres som kommende, ikke som tomme data.
- Detaljsider har kun «← Tilbake» som bruker faktisk historikk (`router.history.back()` med fallback til registerlisten). Filtre og søk ligger i URL-søkeparametere slik at tilbake gjenoppretter kontekst.

## Globalt søk

Tenant-scopet søkefelt i modulens topplinje. Slår opp i `network_contacts`, `companies` (kun selskaper brukeren har relasjon til eller mulighet knyttet til) og `user_opportunities`. Resultater grupperes etter objektklasse og lenker til detaljside. Ingen oppslag mot staging eller andre brukeres rader.

## Selskaper

**Liste:** kompakt register med selskap, bransje/sted når kjent, brukerens status og prioritet, antall egne kontakter, åpne muligheter, neste aktivitet, siste reelle aktivitet. Tomtilstand forklarer at selskaper kommer fra importerte kontakter, jobbmuligheter eller eksplisitt lagt til selskapsrelasjon.

**Detaljside** som fast panelgrid: Selskapsprofil (register), Arbeidsgiverinnsikt (åtte dimensjoner når analyse finnes, ellers «ikke analysert»), Match med Min profil (preferanse og kompetanse som to separate måltall med grunnlag og tidspunkt), Dine kontakter i selskapet (minst to rader synlig, navn lenker til kontaktdetalj), Aktive muligheter, Aktiviteter og neste steg, Dokumenter og søknader. Alle tall og rader er klikkbare til riktig detaljflate.

## Kontakter

**Liste:** navn, tittel, selskap, relasjon, neste aktivitet, sist kontaktet. Telefon, e-post og LinkedIn-lenke vises kun når verdien faktisk finnes i produktlaget.

**Detaljside:** navn/tittel/selskap øverst, selskapsnavn lenker til selskapssiden. Paneler: kontaktprofil og kanaler, relasjon/introduksjon/referanse, relevante muligheter, aktiviteter og tidslinje, notater, mottatte anbefalinger kun ved eksplisitt brukerkobling. LinkedIn-endorsements vises ikke her.

## LinkedIn-import i UI

Importstatus og batchoppsummering vises i Kildeimport/Kildegjennomgang med tellinger delt på personkontakter, selskapsobservasjoner, nettverksarrangementer, preferansesignaler og invitasjoner uten avklart identitet. Ingen av disse fremstår som lagt til i registeret. Fra oppsummeringen går det en tydelig inngang til den kontrollerte promoteringsgjennomgangen. Ingen automatisk promotering. LinkedIn-cron forblir inaktiv.

## Arbeidsflate

Desktop: fast sidehøyde innenfor viewport, stabilt panelgrid, intern scrolling per panel, sticky paneloverskrift, kollaps til én linje, ingen kort-i-kort, ingen dekorative gradienter. Mobil: én kolonne, vanlig sidescroll, ingen horisontal overflyt, paneler åpnes enkeltvis. Eksisterende designsystem, typografi og komponenter gjenbrukes uendret.

## Migrasjon i 5A

Kun selskapsrelasjonen, siden Selskaper bygges nå:

- `user_company_relationships`: nye kolonner `status` (`following`, `target`, `active_dialogue`, `applied`, `former_employer`, `paused`) og `priority` (`low`, `normal`, `high`), begge nullable med validering. Eksisterende rader endres ikke, og verdier utledes aldri fra LinkedIn-import.
- RLS beholdes med `user_id = auth.uid()`, ingen `anon`-tilgang, `authenticated` og `service_role` får eksplisitte GRANT-er.

`next_steps`-utvidelsen (`activity_type`, `status`, `result_note`) hører til Aktiviteter og gjøres i 5B.

## Teknisk

- Lesing skjer gjennom bruker-scopede server-DTO-er per flate (`network.contacts`, `network.companies`, `network.search`, `network.import-status`), aldri direkte mot staging-tabeller.
- Skriving går via kanoniske serverruter/RPC-er. Ingen service-role-nøkkel i klientkode.
- Produktobjekter: `network_contacts`, `network_contact_identities`, `network_contact_company_relations`, `companies`, `user_company_relationships`, `user_opportunities`, `next_steps`, `documents`. Søknadsbundne `contacts` blandes ikke inn.
- Alle DTO-felter bærer datatilstand (`present`, `missing_in_source`, `not_imported`, `not_analyzed`, `stale`) og kildeklasse etter kontraktens punkt 0.3.
- Nettverksregisteret er i dag tomt fordi ingen LinkedIn-data er promotert, så alle flatene må ha reelle tomtilstander som primærtilstand — ingen demodata.

## Verifisering før stopp

Rutetilgjengelighet, tomtilstander, tenant-scopet søk, dype lenker og tilbake-navigasjon, RLS-kontroll på tvers av brukere, skjermbilder desktop 1440 px og mobil 390 px, samt bekreftelse på at ingen LinkedIn-data ble promotert og at klientbunten ikke inneholder hemmeligheter.

## Fase 5B (etter godkjenning av 5A)

Aktiviteter med utvidet `next_steps`-modell og samlet «Legg til aktivitet», Muligheter som board og detaljside med annonsekontakt, dokumenter, tidslinje og separate matchmåltall, Oversikt med klikkbare KPI-er, samt capability-kontrakt for KI-aktivitetsforslag (`available | not_configured | unavailable`) som holdes skjult i UI til tjenesten er aktiv.
