# Fase 5H — kontrollert selskapsidentitetsavstemming

Nettverksselskapene er i dag bare navn observert fra LinkedIn. Uten en bekreftet kobling til et registrert selskap forblir arbeidsgiverinnsikt og nøkkeltall tomme. Fase 5H bygger koblingslaget — med bekreftelse fra brukeren som eneste vei til en varig kobling.

## Prinsipper

- LinkedIn-navnet beholdes uendret som kildeobservasjon. Koblingen legges ved siden av, aldri over.
- Organisasjonsnummer som allerede finnes i kilden gir sikker, automatisk kobling.
- Navnelikhet gir kun forslag. Ingen automatisk kobling, ingen automatisk opprettelse av selskaper.
- Ingen masseopprettelse av globale selskaper fra LinkedIn-navn. Et selskap opprettes bare når brukeren bekrefter en konkret juridisk enhet i registeret.
- Status og prioritet settes aldri av avstemmingen.

## Klassifisering

Hvert observert selskapsnavn får én av fire tilstander:

- **Entydig kandidat** — én registertreff med høy sikkerhet (normalisert navnelikhet, ingen konkurrerende treff).
- **Mulig kandidat** — flere treff eller svakere likhet. Krever individuelt valg.
- **Ikke funnet i registeret** — ingen treff i norsk register.
- **Utenlandsk eller ukjent** — navnet peker ikke mot en norsk juridisk enhet (utenlandsk selskap, gruppe, community, produktnavn).

## Brukerflate

Ny flate «Selskapsavstemming» under Nettverksarbeid → Selskaper.

- Samme tette arbeidsliste som kildegjennomgangen: avhukingsrader, én kolonne på mobil, tre på desktop, fire på bred desktop.
- **Massebekreftelse er begrenset til entydige kandidater.** Mulige kandidater, ikke funnet og utenlandsk/ukjent er egne seksjoner uten forhåndsvalg.
- Hver rad viser LinkedIn-navnet og den foreslåtte enheten med organisasjonsnummer, organisasjonsform og kommune, slik at brukeren ser hva som bekreftes.
- Mulige kandidater åpnes enkeltvis med kandidatliste og søkefelt, samme mønster som «Finn ny arbeidsgiver».
- Bekreftelsesdialog med antall før noe skrives. Avhukinger overlever søk og filtrering.
- Etter kjøring: antall koblet, hoppet over, avvist og feilet, med sanitert forklaring per feil. Ett forslag som feiler påvirker aldri de andre.
- Brukeren kan markere «ikke aktuelt». Valget lagres mot den konkrete kildeobservasjonen, slik at det ikke blokkerer andre selskaper med samme navn.

## Datamodell og skrivelag

Koblingen knyttes til den konkrete observerte selskapskilden, ikke til navnet alene. Samme navn kan være ulike juridiske enheter, grupper, tidligere navn eller selskaper i forskjellige land, og et «ikke aktuelt»-valg skal derfor gjelde den observasjonen — aldri alle framtidige selskaper med samme navn.

Ny brukerscopet koblingstabell lagrer minst:

- `user_id`
- `source_observation_id` eller stabil `source_identity_key`
- `normalized_name`
- `company_id` og `orgnr` når koblet
- `match_method` (`source_orgnr`, `name_exact`, `name_possible`, `manual_search`)
- `matcher_version`
- `confidence` og tilstand (`suggested`, `confirmed`, `rejected`, `not_applicable`, `not_found`, `foreign_unknown`)
- `confirmed_at` / `rejected_at`
- `superseded_at` når en nyere avstemming erstatter forslaget

Skrivelag og validering:

- Kandidatgenerering skjer i en SECURITY DEFINER-funksjon som leser registerspeilet på serversiden. Frontend leser aldri registertabellene direkte.
- Bekreftelsesfunksjonen **validerer kandidaten på serveren**: det valgte organisasjonsnummeret må enten ligge i den gyldige kandidatmengden for nøyaktig den kildeobservasjonen, eller være valgt gjennom den eksplisitte registersøksflyten (`manual_search`), som logges som egen matchemetode. En vilkårlig kombinasjon av navn og organisasjonsnummer godtas aldri bare fordi selskapet finnes i registeret.
- Bekreftelse sikrer selskapsraden gjennom eksisterende `ensure_company_for_employer`, skriver koblingen og oppretter eller oppdaterer `user_company_relationships` — uten status eller prioritet.
- Funksjonene tar aldri `user_id` fra klienten; alt scopes på `auth.uid()`.

### Direkte kobling fra pålitelig orgnr-kilde

Når annonse- eller mulighetsgrunnlaget allerede inneholder organisasjonsnummer, opprettes koblingen uten ny brukerbekreftelse. Den må da merkes `match_method = source_orgnr`, ha kilde/proveniens og tidspunkt, valideres mot registerspeilet, aldri endre status eller prioritet, ha revisjonsspor, og kunne overstyres eller frakobles av brukeren senere. Dette gjelder aldri LinkedIn-navn alene.

### Tilgang og duplikatvern

- `authenticated` får kun `SELECT` på egne rader. `INSERT`, `UPDATE` og `DELETE` går utelukkende gjennom de kanoniske RPC-ene med `auth.uid()`-kontroll. Ingen `anon`-rettigheter.
- Unike indekser hindrer: to aktive koblinger for samme bruker og samme kildeobservasjon, doble `user_company_relationships` for samme bruker og selskap, og doble globale selskaper for samme organisasjonsnummer.


## Effekt på selskapsdetaljen

Selskapsdetalj og mulighetsdetalj slår opp bekreftet kobling først, deretter organisasjonsnummer. Da fylles «Arbeidsgiverinnsikt» og «Registerdata og nøkkeltall» med reelle data for koblede selskaper. Ukoblede selskaper beholder dagens tomtilstand, nå med en lenke til avstemmingen.

## Verifikasjon

- Avstemming kjøres i innlogget økt med telling før og etter. Ett bevisst feilende forslag bekrefter at øvrige valg står.
- Minst ett reelt nettverksselskap kobles og kontrolleres visuelt: åtte dimensjoner med analysetidspunkt og kildetype, og nøkkeltall med regnskapsår og valuta.
- Kontroll på at ingen nye globale selskaper er opprettet utover de bekreftede, og at ingen relasjon har fått status eller prioritet automatisk.

## Allerede levert i denne runden

Ende-til-ende-kontroll av språkhandlingen, kjørt som reell RPC-sekvens i en transaksjon som ble rullet tilbake: godkjenning → `linkedin_promote_qualification` gir `already_registered` mot brukerens eksisterende «Engelsk»-atom, forslaget settes til `dismissed` med årsak «finnes allerede», ingen nytt atom (2 aktive språkatomer før og etter) og ingen ny feilhendelse.
