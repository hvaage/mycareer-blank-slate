# Fase 5E — Kontaktdetalj mot mockup og kildekontrakt

Kontaktdetaljen bygges om til et arbeidskort med fast panelrutenett, sticky paneloverskrifter og intern scroll. Ingen automatisk berikelse, ingen overskriving av manuelle verdier.

## Verifisert utgangspunkt

- `network_contacts` har i dag `manual_display_name`, `manual_headline`, `manual_updated_at` — men **ingen** felt for e-post, telefon eller notater. Disse må legges til additivt.
- Manuell selskapstilknytning finnes allerede (`network_contact_company_relations` med `is_active`, `relation_kind`, `relation_status`, `valid_from/valid_to`, `company_id`).
- Annonsekontakt finnes i `network_posting_contacts` (bruker-scopet, koblet til mulighet og annonsekilde) og kan brukes som kilde «Fra jobbannonse».
- LinkedIn-profil-URL kommer fra `network_contact_identities` med `last_observed_at` — allerede eksponert i leselaget.
- Eksterne lenker går allerede gjennom `ExternalUrlLink` (ny fane, frame-busting).
- Anbefalinger ligger i `career_recommendations` uten kobling til `network_contacts`; panelet leverer derfor kun eksplisitt koblede rader (se under).

## 1. Datamodell (additiv migrasjon)

- `network_contacts`: nye kolonner `manual_email text`, `manual_phone text`, `manual_notes text`, `manual_relation_status text`. Ingen backfill, ingen endring av eksisterende kolonner. LinkedIn-importen skriver aldri til disse.
- `manual_relation_status` beskriver **kun brukerens relasjon til personen**, aldri kontaktens ansettelsesforhold. Tillatte og CHECK-validerte verdier: `ukjent`, `varm`, `aktiv`, `referanse`, `ikke_aktuell`. Selskapstilknytning eies fortsatt av `network_contact_company_relations`.
- Anbefalingskobling: `network_contacts` og `career_recommendations` får bruker-scopede nøkler (`UNIQUE (id, user_id)`), deretter `career_recommendations.network_contact_id uuid` med sammensatt FK `(network_contact_id, user_id) → network_contacts(id, user_id)`. Kun mottatte anbefalinger (`direction = 'received'`) kan kobles. Frakobling nullstiller kun `network_contact_id` og bevarer anbefaling og revisjonsspor.
- RPC-autorisering: alle nye/endrede RPC-er er SECURITY DEFINER, henter bruker fra `auth.uid()` internt, avviser manglende sesjon, validerer at kontakt, anbefaling og relasjoner eies av samme bruker, låser `search_path`, og gir aldri EXECUTE til `anon`. Ingen RPC tar `p_user_id` som autoritativ parameter — verken fra klient eller serverhandling.
- Nye/endrede RPC-er: `network_update_contact_contact_points(p_contact_id, p_email, p_phone)`, utvidelse av `network_update_contact_manual_fields` med notater og relasjonsstatus, og `network_link_recommendation_contact(p_recommendation_id, p_contact_id)` / tilhørende frakobling.


## 2. Toppnivå

Navn, aktiv tittel og selskap (lenke til selskapsdetalj når selskap finnes), LinkedIn som ekstern lenke, «Sist observert i LinkedIn», relasjonsstatus når satt. Tilbake-lenken får kun teksten «Tilbake» og bevarer opprinnelig kontekst.

## 3. Panelrutenett

```text
Kontaktpunkter            |  Neste aktivitet + Relasjon og notater
Selskaper                 |  Muligheter
Aktiviteter og tidslinje  |  Anbefalinger
```

- **Kontaktpunkter** (alltid øverst): e-post, telefon, LinkedIn. Kilde og tidspunkt per verdi. Manglende verdi vises som «Ikke registrert». Inline redigering av e-post/telefon via ny serverhandling. Annonsekontaktverdier vises som «Fra jobbannonse» med observert tidspunkt, sekundært under den manuelle aktive verdien.
- **Relasjon og notater**: relasjonstype/status og brukerens fritekstnotat, lagres eksplisitt.
- **Selskaper**: aktiv og historisk observert tilknytning, navn lenker til selskapsdetalj, LinkedIn-observasjoner merkes som kildeinformasjon.
- **Muligheter**: stilling, selskap, status og neste aktivitet, rad lenker til mulighetsdetalj, reell tomtilstand.
- **Aktiviteter og tidslinje**: dato først på samme linje, visuelt skille mellom planlagt, utført og avlyst, klikk åpner aktivitetsredigering, «Logg aktivitet» bruker kanonisk aktivitetsflyt.
- **Anbefalinger**: kun eksplisitt koblede, merket «Tredjepartsinformasjon fra LinkedIn». Ingen forslag basert på navnelikhet.
- **Endorsements fjernes** helt fra kontaktdetaljen.

## 4. Layout

Desktop: fast detaljflate, hvert panel scroller internt. Mobil: én kolonne, ingen horisontal scroll. Kontaktpunkter og neste aktivitet i første synlige del. Tomtilstander forklarer hva som mangler og hvordan det legges til.

## 5. Sikkerhet

RLS beholdes, ingen `anon`-grants, ingen automatisk promotering, reimport rører aldri manuelle verdier. Avvikende LinkedIn-observasjon vises sekundært.

## Verifikasjon før rapport

1. Innlogget bruker lagrer e-post og telefon på egen kontakt (SQL-bekreftelse).
2. Kryssbrukertest: bruker B kan verken lese eller endre bruker As verdier.
3. Simulert reimport lar manuelle verdier stå urørt.
4. Kontakt uten e-post/telefon viser «Ikke registrert».
5. Kontakt med annonsekontaktdata viser riktig kilde og tidspunkt.
6. LinkedIn åpnes i ny fane uten innbygging.
7. Lenker til selskap, mulighet og aktivitet treffer riktig detalj; «Tilbake» bevarer kontekst.
8. Skjermbilder ved 1440 px og 390 px, uten horisontal overflyt eller konsollfeil.

Stopp etter denne leveransen med rapport over nye/endrede felter, skriveveier og testresultater.
