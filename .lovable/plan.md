# Nettverk og muligheter: produktkontrakt først, deretter tre atskilte leveranser

Arbeidet deles i tre leveranser som ikke slås sammen. Denne runden leverer kun dokumentet i leveranse C, trinn 1. Ingen migrasjon, ingen UI-endring, ingen kodeendring før dokumentet er godkjent.

## Denne runden: `docs/network-opportunities-product-contract-v1.md`

Dokumentet er kilde-til-produkt-kontrakt for fem flater: Oversikt, Selskaper, Kontakter, Muligheter, Aktiviteter.

For hver flate angis: hvilke data som vises, hvilken tabell/DTO som eier hvert felt, kildeklassifisering (brukeroppgitt, LinkedIn-observasjon, Brønnøysund/arbeidsgiverregister, arbeidsgiveranalyse, aktivitet), hentet/importert tidspunkt, hva som er redigerbart, hva som krever eksplisitt brukerhandling, hvilke detaljer som er lenkbare til selskap/kontakt/mulighet/dokument/aktivitet, samt tomtilstand og datamangeltilstand.

Minimumsmodellene for Kontakt, Selskap og Mulighet tas inn ordrett som normativ del av kontrakten, inkludert at LinkedIn-støttesignaler kun vises som aggregert antall og at mottatte anbefalinger merkes som tredjepartsinformasjon.

Dokumentet inneholder også datamatrisen: kilde → staging → forslag → promoterbart produktobjekt → UI-flate, én rad per informasjonstype (stilling, kompetanse, endorsement-signal, anbefaling mottatt, anbefaling gitt, kontakt, selskap, kurs, innhold, mulighet, aktivitet), med markering av hva som aldri importeres.

Dokumentet skiller eksplisitt mellom navngivning: «attestering» brukes ikke om LinkedIn-data. LinkedIn-endorsements er tredjepartssignal, aldri documented, verified eller user_attested.

Kontrakten fastsetter også kildeavgrensning: jobbsignaler, annonseklikk og inferert annonseprofil importeres aldri; application-bundne kontakter er ikke nettverksregister.

## Leveranse A (senere): driftslag for LinkedIn-import

Varig jobbmodell med tilstandene queued → running → succeeded | partially_succeeded | failed | cancelled. Lease, hjerteslag, reaper og definert retry/backoff. Opplastingen svarer straks etter at jobben er registrert, uten fire-and-forget. Brukeren kan lukke siden. Status og tellere vises i importoversikten. Varsel i appen ved fullført eller feilet jobb; e-post kun når kanalen faktisk er konfigurert og brukeren har valgt e-postvarsling. Verken logger eller e-post inneholder rå LinkedIn-data, anbefalingstekst eller kontaktdata.

## Leveranse B (senere): korrigert data- og promoteringsmodell

Endorsement-signaler skilles ut som eget tredjepartssignal med kun kompetanseidentitet, aggregert antall, kildesystem og observasjonstidspunkt — uten personnavn i produktlaget. Mottatte og gitte anbefalinger holdes atskilt; kun mottatte kan foreslås videre. Ingen anbefaling eller endorsement brukes automatisk i CV eller søknad.

Nettverksimport: massepromotering tillates som én eksplisitt brukerhandling etter en oppsummering med antall nye kontakter, eksakte LinkedIn-identitetsmatcher, mulige dubletter, kontakter uten stabil identitet og kontakter som ikke importeres. Eksakt LinkedIn-URL kan koble; navnelikhet gir alltid mulig dublett, aldri sammenslåing. Reimport oppdaterer staging, men overskriver aldri promotert tittel eller selskap automatisk — endringer blir egne forslag eller en godkjent batchoppdatering.

Karriere, kurs og innhold: karriereavstemmingen rettes som ny reconciliation_version uten å endre allerede behandlede forslag. Kurs leser faktisk kursnavn, tilbyder, fullført-dato og URL fra riktige kildekolonner; «sist sett» brukes aldri som fullført-dato. Artikler og innhold er profil- og porteføljemateriale, ikke CV-påstander.

## Rekkefølge og stoppunkt

1. Produktkontrakt og datamatrise leveres som dokument. **Stopp for godkjenning.**
2. Leveranse A.
3. Leveranse B.
4. UI for Nettverk og muligheter bygges først etter at kontrakten er godkjent.
