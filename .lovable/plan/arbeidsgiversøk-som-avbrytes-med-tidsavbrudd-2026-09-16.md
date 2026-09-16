# Arbeidsgiversøk som avbrytes med tidsavbrudd

To av de tre funnene er rettet direkte (glidebryteren i rekruttererskjemaet og
kulepunktene i PDF-rapporten). Det tredje — at enkelte søk på
arbeidsgiversidene avbrytes og gir feilmelding i stedet for treff — er bekreftet,
men krever endringer i databasen og bør godkjennes først.

## Hva som skjer i dag

Et søk utløser tre databasekall samtidig: trefflisten, treffantallet og
ansattefordelingen. Brede søkeord eller søk med filtre må gå gjennom hele
enhetsregisteret i stedet for det raske søkespeilet. Når det tar lengre tid enn
tidsgrensen, avbryter databasen kallet. Brukeren ser da en feilmelding, mangler
treffantall, og banneret sier at tallene ikke kunne beregnes.

## Forslag til løsning

1. **Begrens kandidatmengden før sortering.** Søket rangerer i dag hele
   kandidatmengden. Vi henter i stedet et tak per rangeringsnivå (f.eks. navn
   starter med / inneholder) og sorterer bare innenfor dette. Det gir samme
   topptreff, men langt kortere kjøretid på brede søk.
2. **Utvid søkespeilet slik at filtrerte søk også treffer det.** Legg
   kommune-, fylkes- og bransjefelt inn i speilet, slik at filtrerte søk slipper
   å skanne hele registeret.
3. **Kjør treffantall og ansattefordeling etter trefflisten,** ikke samtidig, og
   la dem bruke samme kandidatgrense. Det fjerner tre-fire tunge kall på én gang.
4. **Bedre oppførsel ved avbrudd i grensesnittet:** i stedet for en rå
   feilmelding vises «Søket tok for lang tid — prøv et mer spesifikt søkeord»
   med knapp for å prøve igjen, og treffantallet vises som «mange treff» framfor
   å forsvinne.

## Teknisk

- Additiv migrasjon som oppdaterer funksjonene `search_employers`,
  `count_employers` og `employer_ansatte_distribution` med kandidattak per
  rangeringsnivå, og utvider speilet `reg.enheter_sok` med filtreringskolonner
  og tilhørende indekser.
- `src/lib/queries/employer-insight.ts`: kjør treffantall/fordeling etter
  trefflisten, og skill tidsavbrudd (kode 57014) fra andre feil i
  returverdien.
- `src/routes/_authenticated/vurdering-av-arbeidsgivere/index.tsx`: egen
  melding og «Prøv igjen» ved tidsavbrudd.
- Oppdater `docs/employer-search-performance.md` med nye målinger.

## Verifisering

- Måling av de dokumenterte tunge søkeordene («bygg», brede filtersøk) før og
  etter, kaldt og varmt, med krav om god margin til tidsgrensen.
- Kontroll av at trefflistene er identiske for et sett representative søk.
- Full testsuite, typekontroll, lint og bygg.
