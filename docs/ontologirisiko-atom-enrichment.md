# Ontologirisiko i atom-enrichment (funn, ikke løst)

Status: åpne funn per 2026-08-15. Disse er blokkerende for ontologimigrasjonene.
Konklusjon: **migrasjonene kan ikke kjøres før `src/lib/queries/atom-enrichment.ts`
er skrevet om.** Funnene er samtidig svaret på spørsmålet om overlappende modeller
(punkt 3 i kartleggingen av karriereflaten).

Kilder: `src/lib/queries/atom-enrichment.ts`, `src/lib/queries/cv-imports.ts`,
tabellene `atom_enrichment_proposals`, `user_evidence_atoms`, `cv_evidence_atoms`.

## Funn 1 — Forslag bærer ikke peker-ID-er (tyngst)

`create_atom`-forslag setter aldri `evidence_atom_ids`. Dette er ikke en
lagringsfeil: **forslagsformatet selv må endres**. Et forslag uten peker-ID-er kan
ikke bli et gyldig kompetanse- eller eksponerings-atom uansett hvordan det skrives,
fordi disse klassene bare kan belegges indirekte — via pekere til kvalifikasjons-,
resultat- eller rolle-atomer.

Konsekvens: godkjenning av slike forslag produserer atomer uten sporbarhet, i strid
med evidensprinsippet.

Rekkefølge for utbedring: (1) utvid forslagsskjemaet med obligatoriske
`evidence_atom_ids` for indirekte klasser, (2) la generatoren fylle dem, (3) avvis
godkjenning når de mangler, (4) først deretter migrasjon.

## Funn 2 — `confidence_score` og `confidence` er ikke samme akse

`atom_enrichment_proposals.confidence_score` er numerisk 0–1.
`cv_evidence_atoms.confidence` er tekst og beskriver **opprinnelse**, ikke sikkerhet.
En konvertering mellom dem ville vært å finne på et tall.

Åpent spørsmål som må avklares før omskriving: hva var `confidence_score` ment å
bety? Er det AI-ens sikkerhet, hører den hjemme på **forslaget** og skal ikke følge
med inn i atomet. Er det noe annet, må betydningen defineres eksplisitt før noen
mapping skrives.

Til avklaringen foreligger: ikke skriv `confidence_score` inn i
`cv_evidence_atoms.confidence`.

## Funn 3 — Skriving mot utfaset tabell

`atom-enrichment.ts` skriver fortsatt til `user_evidence_atoms`. Tabellen utfases til
fordel for `cv_evidence_atoms`. Godkjenningsflyten vil feile når migrasjonene håndhever
den nye modellen.

## Funn 4 — `// @ts-nocheck` skjuler funn 1–3

Filen er unntatt typekontroll, så kompilatoren fanger ikke opp verken feil måltabell,
feil felttype eller manglende pekere. Fjerning av `@ts-nocheck` bør være **første**
steg i omskrivingen, ikke siste.

## Sidefunn — avkortet forslagsliste

Statuslistene i AI-forslag henter maks `ATOM_ENRICHMENT_PROPOSAL_LIST_LIMIT` (80) rader.
Uten merking er dette samme feilklasse som det tidligere Utvalgsinnsikt-panelet: tall
som ser fullstendige ut uten å være det. Ser brukeren 80 forslag og det finnes 200, vet
han ikke at 120 mangler.

Midlertidig tiltak (gjort): listen merkes synlig som avkortet når taket nås.
Varig løsning: paginering eller totalteller fra databasen.
