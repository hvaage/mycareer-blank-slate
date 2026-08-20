# Nettverk og muligheter: produktkontrakt først, deretter tre atskilte leveranser

Arbeidet deles i tre leveranser som ikke slås sammen. Denne runden leverer kun dokumentet i leveranse C, trinn 1. Ingen migrasjon, ingen UI-endring, ingen kodeendring før dokumentet er godkjent.

## Denne runden: `docs/network-opportunities-product-contract-v1.md`

Dokumentet er kilde-til-produkt-kontrakt for fem flater: Oversikt, Selskaper, Kontakter, Muligheter, Aktiviteter.

For hver flate angis: hvilke data som vises, hvilken tabell/DTO som eier hvert felt, kildeklassifisering (brukeroppgitt, LinkedIn-observasjon, Brønnøysund/arbeidsgiverregister, arbeidsgiveranalyse, aktivitet), hentet/importert tidspunkt, hva som er redigerbart, hva som krever eksplisitt brukerhandling, hvilke detaljer som er lenkbare til selskap/kontakt/mulighet/dokument/aktivitet, samt tomtilstand og datamangeltilstand.

Minimumsmodellene for Kontakt, Selskap og Mulighet tas inn ordrett som normativ del av kontrakten, inkludert at LinkedIn-støttesignaler kun vises som aggregert antall og at mottatte anbefalinger merkes som tredjepartsinformasjon.

Dokumentet inneholder også datamatrisen: kilde → staging → forslag → promoterbart produktobjekt → UI-flate, én rad per informasjonstype (stilling, kompetanse, endorsement-signal, anbefaling mottatt, anbefaling gitt, kontakt, selskap, kurs, innhold, mulighet, aktivitet), med markering av hva som aldri importeres.

Dokumentet skiller eksplisitt mellom navngivning: «attestering» brukes ikke om LinkedIn-data. LinkedIn-endorsements er tredjepartssignal, aldri documented, verified eller user_attested.

### Normativt vedlegg: «Skjermatferd for Nettverk og muligheter v1»

Kontrakten får et eget normativt vedlegg som fastsetter visning og navigasjon:

- **Modul og navigasjon.** «Nettverk og muligheter» ligger under «Min karriere», før «Marked». Nivå-2-navigasjon: Oversikt, Selskaper, Kontakter, Muligheter, Aktiviteter. Globalt søk er avgrenset til brukerens eget tenant og dekker kontakt, selskap og mulighet. Lenker mellom kontakt, selskap, mulighet, dokument og aktivitet åpner riktig detaljside. «Tilbake» returnerer til forrige kontekst, ikke alltid til registerets hovedliste.
- **Arbeidsflate.** Desktopflatene er kompakte arbeidsflater, ikke lange landingssider. Detaljsider bruker faste paneler med rulling inne i panelet. Paneler kan kollapses til én linje, og panelets overskrift står fast så lenge panelet er åpent. Mobil har samme informasjonsprioritering uten horisontal overflyt.
- **Oversikt.** KPI-ene «Trenger oppfølging», «Aktive muligheter», «Varme kontakter» og «Intervjuer» er alltid lenker til filtrerte underlister. Standardbildet viser kun nylig relevante selskaper og aktiviteter. AI-forslag til aktivitet er forslag til godkjenning, aldri automatisk registrerte aktiviteter.
- **Kontakt.** Kontaktkortet viser identitet, rolle, selskap, LinkedIn-observasjon, siste og neste aktivitet, relasjonsopplysninger og eventuelle tredjepartssignaler. Navn og selskap er lenkbare. LinkedIn-data merkes med kilde og «sist observert», og presenteres aldri som bekreftet kontaktdata.
- **Selskap.** Siden viser registerdata, arbeidsgiverinnsikt når tilgjengelig, brukerens kontakter, muligheter, dokumenter, aktivitet og neste steg. Arbeidsgiverinnsikt, registerdata og brukerens egen relasjon har tydelig ulike kildeetiketter. Manglende analyse eller registerdekning har eksplisitt tomtilstand.
- **Mulighet.** Overskriften viser stilling først, deretter selskap. Kontaktperson fra annonsen er et eget kontaktobjekt når den finnes. Preferansematch og kompetansematch vises som to separate måltall. Dokumenter brukt, annonse-URL, tidslinje, neste aktivitet og relevante kontakter er direkte tilgjengelig. En lead blir aldri søknad eller mulighet uten eksplisitt brukerhandling.
- **Aktiviteter.** Aktivitet har type, knytning til kontakt/selskap/mulighet, prioritet, forfallsdato eller «om X dager», status og gjennomført-tidspunkt. Å markere som utført lagrer faktisk dato og flytter aktiviteten til gjennomført historikk. AI-genererte forslag må godkjennes og få frist før de opprettes.
- **Datatilgjengelighet.** Alle UI-DTO-er skiller mellom: data finnes, data mangler i kilden, data er ikke importert for valgt formål, data er ikke ennå analysert, og data er utløpt eller ikke lenger fersk.

Vedlegget lenker til en godkjent wireframe-/designreferanse som illustrerer reglene. Referansen er illustrasjon, ikke produksjonskode.



Kontrakten fastsetter også kildeavgrensning: jobbsignaler, annonseklikk og inferert annonseprofil importeres aldri; application-bundne kontakter er ikke nettverksregister.

## Leveranse A (senere): driftslag for LinkedIn-import

Varig jobbmodell med tilstandene queued → running → succeeded | partially_succeeded | failed | cancelled. Lease, hjerteslag, reaper og definert retry/backoff. Opplastingen svarer straks etter at jobben er registrert, uten fire-and-forget. Brukeren kan lukke siden. Status og tellere vises i importoversikten. Varsel i appen ved fullført eller feilet jobb; e-post kun når kanalen faktisk er konfigurert og brukeren har valgt e-postvarsling. Verken logger eller e-post inneholder rå LinkedIn-data, anbefalingstekst eller kontaktdata.

## Leveranse B (senere): korrigert data- og promoteringsmodell

Endorsement-signaler skilles ut som eget tredjepartssignal med kun kompetanseidentitet, aggregert antall, kildesystem og observasjonstidspunkt — uten personnavn i produktlaget. Mottatte og gitte anbefalinger holdes atskilt; kun mottatte kan foreslås videre. Ingen anbefaling eller endorsement brukes automatisk i CV eller søknad.

Nettverksimport: massepromotering tillates som én eksplisitt brukerhandling etter en oppsummering med antall nye kontakter, eksakte LinkedIn-identitetsmatcher, mulige dubletter, kontakter uten stabil identitet og kontakter som ikke importeres. Eksakt LinkedIn-URL kan koble; navnelikhet gir alltid mulig dublett, aldri sammenslåing. Reimport oppdaterer staging, men overskriver aldri promotert tittel eller selskap automatisk — endringer blir egne forslag eller en godkjent batchoppdatering.

Karriere, kurs og innhold: karriereavstemmingen rettes som ny reconciliation_version uten å endre allerede behandlede forslag. Kurs leser faktisk kursnavn, tilbyder, fullført-dato og URL fra riktige kildekolonner; «sist sett» brukes aldri som fullført-dato. Artikler og innhold er profil- og porteføljemateriale, ikke CV-påstander.

## Rekkefølge og stoppunkt

1. Produktkontrakt og datamatrise leveres som dokument. **Stopp for godkjenning.**
2. Leveranse A: driftslag for LinkedIn-import. Syntetisk test- og driftsrapport leveres. **Stopp ved avvik.**
3. Leveranse B: korrigert data- og promoteringsmodell. Syntetisk datakvalitets-, RLS- og idempotensrapport leveres. **Stopp for godkjenning.**
4. Separat, eksplisitt godkjent ende-til-ende-akseptansetest med Henriks LinkedIn-eksport. Testen kjører import, staging og avstemming, men ingen automatisk promotering. Testinstruksen leveres før kjøring. **Stopp for rapport og godkjenning.**
5. UI for Nettverk og muligheter bygges først etter at produktkontrakten, Leveranse A, Leveranse B og akseptansetesten er godkjent.

