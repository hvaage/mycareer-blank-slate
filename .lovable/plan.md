# Korriger CV-gjennomgangen mot den avtalte trinnvise flyten

## Observert nå (fra kode og skjermbildet fra /career/cv-review)

- AI-panelet «Analyser erfaringene dine» rendres alltid øverst, foran trinnene. Det får analysekandidater = kun bekreftede funn (tom liste), derav «Ingen funn å analysere i dette utvalget» ved klikk.
- Samme panel viser «59 funn er ikke gjennomgått» — hele den flate parse-køen, uten rolle- eller tidsgruppering. Det står i direkte motstrid med trinn 2 sitt «19 til gjennomgang · 5 grupper».
- Trinn 1 og 2 finnes (`CvReviewTimelineStep`, `CvReviewResultsStep`). Trinn 3 (kompetanse) og trinn 4 (kvalifikasjoner) finnes ikke som komponenter — flyten faller tilbake til den flate fanevisningen (Til gjennomgang / Bekreftet / Spørsmål / Avvist).
- Ingen synlig fremdriftslinje «Roller ✓ | Resultater 3 av 5 | Kompetanse | Kvalifikasjoner».
- Ingen «Gå gjennom nå / Senere»-valg etter fullført atomisering.

## Gap-matrise (verifiseres og utvides med faktisk browsergjennomgang før retting)

| Krav | Observert | Berørt del | Retting |
| --- | --- | --- | --- |
| Ingen konkurrerende flat kø | AI-panel + 59-teller øverst | `cv-review.tsx`, `CvAnalysisPanel.tsx` | Fjern panelet fra trinnflyten; ingen rå-teller |
| Trinn 1 tidslinje komplett | Finnes, må verifiseres mot Cisco/NetApp | `CvReviewTimelineStep.tsx` | Verifiser felt, handlinger, hulldeteksjon |
| Trinn 2 «Hvor hører dette hjemme?» | Har «Resultater uten kjent rolle» | `CvReviewResultsStep.tsx` | Omdøp bolk, legg til rollevalg per resultat |
| Trinn 3 kompetanse med forslag | Mangler | ny `CvReviewSkillsStep.tsx` | Bygg forslag + begrunnelse + confidence |
| Trinn 4 kvalifikasjoner | Mangler | ny `CvReviewQualificationsStep.tsx` | Bygg samlet bekreftelse |
| Fremdrift/gjenopptak synlig | Mangler visning | ny `CvReviewProgressBar` | Trinn, gjenstående, «trenger ny vurdering» |
| Oppstart etter analyse | Går ikke direkte til trinn 1 | opplastingsflyten | «Gå gjennom nå» / «Senere» |

## Rettinger i prioritert rekkefølge

1. **Fjern den flate køen fra trinnflyten.** AI-panelet flyttes ut av toppen og vises bare etter siste trinn, og bare når det finnes bekreftede funn å analysere. Tomme tilstander («Ingen nye forslag akkurat nå») og rå-telleren «59 funn» fjernes. Fanevisningen blir et fallback for foreldede/ferdige importer, ikke standardvisning.
2. **Fremdriftslinje øverst i alle fire trinn:** gjeldende trinn, antall gjenstående per trinn, markering av trinn som trenger ny vurdering etter endringer høyere i kjeden, og en tydelig «du kan fortsette senere». Fremdriften leses fra eksisterende `cv_review_progress` + kandidatsett-signatur; foreldet signatur gjenopptas aldri som uendret.
3. **Trinn 1 verifiseres og korrigeres mot kravene:** alle roller samtidig i kronologisk tidslinje med rolle, arbeidsgiver, periode, antall roller, og handlingene Endre / Legg til rolle / Bekreft alle. Hulldeteksjon vises som «Mulig tidsrom å avklare» kun ved ≥3 måneder og måned-/dagspresisjon i begge avgrensende roller — aldri ved årspresisjon, manglende eller placeholderdato, pågående rolle eller overlapp. Privat tidslinjekontekst merkes og holdes utenfor CV, eksport, modellinput og ATS-grunnlag.
4. **Trinn 2 justeres:** én rolle om gangen med alle resultater samlet, bekreft alle per rolle, endre/avvis enkeltresultat, legg til resultat, neste rolle / tilbake. Bolken for resultater uten sikker strukturell kobling blir «Hvor hører dette hjemme?» med eksplisitt rollevalg eller «la stå frittstående». Manuelt resultat fortsetter gjennom eksisterende RPC (`career_atom_add_manual_result`) — klienten skriver aldri `parent_atom_id`.
5. **Trinn 3 (nytt): kompetanse med foreslått plassering.** Hvert forslag viser kompetanse, foreslått rolle/roller, foreslåtte resultater når relevant, confidence og en konkret begrunnelse basert på faktiske signaler i parsedata. Handlinger: Bekreft / Rett / Hopp over. Én kompetanse kan kobles til flere roller uten duplikat. «Bekreft alle N» vises kun når forslagene har minst ett strukturelt eller eksplisitt kildebasert signal i tillegg til et tekstsignal; to varianter av samme ordlikhet teller som ett. Mangler parseren kildeposisjon, `parent_local_ref` eller tid, vises kompetansen som lav sikkerhet / «trenger vurdering» og bulk-knappen skjules helt. Ingen mekanisk splitting på «og», «&», «/» eller komma i UI.
6. **Trinn 4 (nytt): kvalifikasjoner og resten.** Utdanning, sertifiseringer, språk og verktøy samlet, med bekreft alle, endre enkeltpost og avvis uten sletting.
7. **Oppstart:** når atomiseringen er ferdig sendes brukeren som standard til trinn 1, med valgene «Gå gjennom nå» og «Senere». «Senere» legger importen i Til gjennomgang-køen.

## Grenser som holdes

- Ingen sletting av brukerdata, importer eller filer.
- Ingen endring av CV-generering, attestasjonspanel, eksport eller cron.
- Ingen nye tabeller eller migrasjoner med mindre en dokumentert mangel gjør kravet umulig; da rapporteres det først.
- Ingen handling i importgjennomgangen oppretter `user_attested` — verken enkeltvis eller i bulk.
- Ingen klientskriving til `career_atoms`, `career_atom_links`, `cv_review_progress` eller projeksjonstabellene; alt går via eksisterende promotering og RPC-er. `parent_atom_id` og `evidence_atom_ids` behandles som projeksjoner.
- Brukerredigerte elementer legges ikke inn i `cv_parse_candidates`.

## Verifisering og leveranse

Ekte browsergjennomgang av testimporten på desktop og mobil, med skjermbilder per trinn, og gjennomgang av alle 14 akseptansekriteriene — inkludert Cisco/NetApp-representasjon, 2- vs 3-måneders hull, placeholderdatoer, manuell resultatlenke (aktiv `oppnadd_i` + korrekt projeksjon), lav-sikkerhet uten bulk, flere roller per kompetanse uten duplikat, fravær av `user_attested`, privat kontekst utenfor alt CV-grunnlag, ny vurdering ved rolleendring, gjenopptak på riktig trinn, og ingen overlapp/horisontal overflow.

Til slutt rapporteres måletallene (brukerhandlinger til fullført gjennomgang, antall roller/resultater/kompetanser/kvalifikasjoner, andel forslag godkjent uten korreksjon, kompetanser uten plasseringsgrunnlag, kompetanser med flere roller, brukerlagte elementer, oppdagede tidsrom, bulk-bekreftelser og senere korreksjoner) samt en liste over konkrete parsefeil som må håndteres i cv-evidence-graph v2.
