# Fase 5A — Aktiver nettverksregisteret med kontrollert kontaktimport

## Bekreftet utgangspunkt (verifisert nå)

Aktiv batch `253f0538…`, status `ready`, ukonsumert:

| Objektklasse | Antall | Kategori |
|---|---|---|
| person_contact | 3 881 | new_contact |
| company_observation | 298 | excluded |
| network_event | 89 | excluded |
| network_preference_signal | 34 | excluded |
| invitation | 46 | excluded |

`without_stable_identity` = 0. Produkttabellen `network_contacts` er tom for brukeren.

De kanoniske RPC-ene (`network_promote_batch_person_contacts`, `network_set_company_relationship`) finnes, er `service_role`-begrenset og kalles allerede via serverfunksjoner i `src/lib/network.functions.ts`. Ingen nye skriveveier lages.

## Det som bygges

### 1. Tomtilstand på Kontakter
Når brukeren ikke har promoterte kontakter, viser Kontakter-flaten et importkort:
«Importer nettverket ditt fra LinkedIn», antall funnet personkontakter (3 881), forklaringen om at kontakter først opprettes ved bekreftelse og at LinkedIn ikke overskriver manuelle rettinger, lenke til Kildegjennomgang, og knappen «Gå gjennom og importer kontakter». Ingen andre objektklasser telles som kontakter.

### 2. Egen importgjennomgangsrute
Ny rute `/nettverk/kontakter/import` (fast flate, ikke modal) med:
- oppsummering: 3 881 nye kontakter, 0 uten stabil identitet, kilde `Connections.csv`, importtidspunkt
- «Dette opprettes»: kontakt, kanonisk LinkedIn-identitet, observert selskaps-/rolletilknytning når den finnes
- «Dette opprettes ikke»: aktiviteter, muligheter, selskapsprioritet, navnebasert sammenslåing, e-post/telefon
- egen ikke-handlingsbar seksjon «Andre signaler beholdt som kildeinformasjon» med de fire tellingene og forklaring
- ingen rå rader, hasher eller interne feilkoder

### 3. Eksplisitt bekreftelse
Knapp «Importer 3 881 kontakter» → bekreftelsesdialog med den avtalte teksten (stabil identitet = profil-URL, navnelikhet slår aldri sammen, manuelle endringer overskrives ikke). Kun «Bekreft og importer» kaller serverfunksjonen. Ingen loader, polling, prefetch eller effekt kan utløse promotering — kallet skjer bare i klikkhandleren.

### 4. Fremdrift og resultat
Knappen låses mens kallet pågår; ventetilstand vises. Ved suksess: antall opprettet, antall gjenbrukt (idempotent hoppet over), antall som krever manuell vurdering, og lenke til kontaktregisteret. Ved feil: sanitert melding + «Prøv igjen». Gjentatt kjøring presenteres som «allerede importert», ikke som ny import.

### 5. Kontaktliste og detaljside
Liste: navn, sist observert rolle, aktiv selskapstilknytning, LinkedIn-profil-lenke, sist observert i LinkedIn, brukerens relasjon/status når den finnes, neste aktivitet når den finnes.
Detalj: navn og selskap som lenkbar navigasjon, LinkedIn-observasjon merket som kildeinformasjon med tidspunkt, brukerens verdi alltid aktiv verdi, avvik vises sekundært som «Sist observert i LinkedIn: …». Historikkbevisst «Tilbake» (finnes allerede som `BackLink`).

### 6. Selskaper
Selskaper som kun stammer fra en kontakts observerte tilknytning merkes «relatert via kontakt» og får ingen status/prioritet automatisk. Status og prioritet endres bare via eksisterende `network_set_company_relationship`. `Company Follows` brukes ikke.

### 7. Batchtilstander på importgjennomgangsruten
Ruten håndterer fire tilstander eksplisitt: `ready` og ukonsumert → kontrollert importflyt; konsumert → «Kontaktene er allerede importert»; superseded/stale → «Denne importen er erstattet» med lenke til nyeste gyldige batch; ingen gyldig batch → «Importer en ny LinkedIn-eksport». Knappen «Importer … kontakter» rendres kun i første tilstand.

## Teknisk

- Ny rute: `src/routes/_authenticated/nettverk.kontakter.import.tsx`. Importknappen flyttes fra sidepanelet i `nettverk.kontakter.index.tsx` til denne ruten; sidepanelet blir ren status.
- Databasetillegg (én migrasjon):
  - `network_contacts` får `manual_display_name` og `manual_headline` (nullbare). Ingen direkte UPDATE-grant til `authenticated`; kun `service_role` skriver.
  - `network_contact_company_relations` får `source_class` (`linkedin_observed` | `user_input`), valgfri periode (`valid_from`, `valid_to`), `relation_status` og `is_active`. LinkedIn-observert tilknytning beholdes som separat historikkrad.
  - Ny SECURITY DEFINER-RPC `network_update_contact_manual_fields(p_user_id, p_contact_id, p_display_name, p_headline)`: verifiserer eierskap, oppdaterer kun tillatte felt, setter aktiv verdi med `source_class = user_input`, bevarer LinkedIn-observasjon og tidspunkt separat, logger ikke rå kontaktdata. EXECUTE kun til `service_role`.
  - Ny SECURITY DEFINER-RPC for manuell/korrigert selskapstilknytning som skriver en `user_input`-rad i `network_contact_company_relations` og markerer aktiv relasjon når flere finnes. EXECUTE kun til `service_role`.
  - `network_promote_batch_person_contacts` oppdateres til aldri å røre manuelle felt eller `user_input`-relasjoner ved reimport.
- Nye serverhandlinger i `src/lib/network.functions.ts` kaller de to RPC-ene; `user_id` utledes fra `requireSupabaseAuth`-konteksten og aksepteres aldri fra request-body.
- Kontakt-DTO i `src/lib/queries/network.ts` får `linkedinProfileUrl` (full normalisert URL eller null) og `linkedinObservedAt` (tidspunkt eller null), lest kun fra `network_contact_identities` der `identity_kind = 'linkedin_profile_url'`. Hasher, interne identitetsverdier og tekniske previews returneres aldri. Batchspørringen utvides med tilstand (ready/konsumert/superseded), importtidspunkt og kildefilnavn.
- Ingen endring i grants på de eksisterende RPC-ene. Klienten sender aldri `user_id`.


## Verifikasjon som kjøres og rapporteres

1. Batchtellinger på nytt rett før levering (de fem klassene over).
2. Browser-test: tomtilstand, importgjennomgang uten promotering, avbrutt dialog gir null produktdata, kryssbrukerpromotering blokkeres, dobbeltklikk er idempotent, desktop 1440px og mobil 390px uten horisontal scroll.
3. Syntetisk/transaksjonsrullet promoteringstest: atomisk opprettelse av kontakt + identitet + relasjon, feil midt i batch gir null delvis data, reimport overskriver ikke manuelt redigert verdi.
4. Før/etter-tellinger for den reelle brukeren, med bekreftelse på at batch `253f0538…` fortsatt er `ready` og ukonsumert.

Ingen reell LinkedIn-kontakt promoteres under bygg eller test.
