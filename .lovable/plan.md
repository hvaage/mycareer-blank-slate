# Fase 5C — visuell sluttverifikasjon av detaljsidene

Ingen produktendringer planlagt. Dette er en verifikasjonsrunde med ekte innlogget økt og de 23 reelle mulighetene. Eventuelle feil som avdekkes rettes kun som presentasjonsrettinger (layout, tomtilstand, overskrifter), ikke som endringer i data, RLS eller skrivelag.

## Omfang

Tre detaljsider verifiseres:

- Mulighetsdetalj (`/nettverk/muligheter/$id`)
- Selskapsdetalj (`/nettverk/selskaper/$id`)
- Kontaktdetalj (`/nettverk/kontakter/$id`)

## Slik verifiseres det

Automatisert nettlesertest med ekte innlogget økt (samme metode som i leselags-verifikasjonen). Skjermbilder tas i to bredder: 1440 px (desktop) og 390 px (mobil).

For hver side kontrolleres:

1. Overskrift og topplinje er korrekt — mulighetsdetalj viser `Stilling · Selskap`, begge tydelige.
2. Panelrutenettet stemmer med 5C-kontrakten, paneloverskrifter er alltid synlige, og lange lister får intern scroll i stedet for å strekke siden.
3. Ingen horisontal scroll på 390 px; én kolonne på mobil.
4. Tomtilstander er reelle og forklarende («Ikke analysert ennå», «Ingen annonsekontakt») — aldri en tom boks eller en «0» som ser ut som data.
5. Lenker mellom selskap, kontakt, mulighet, aktivitet og dokument treffer riktig detaljside, og `← Tilbake` bevarer filteret fra listen.
6. Tidslinjen viser dato først, og planlagt skilles visuelt fra utført.
7. Ingen feil i konsollen og ingen 4xx/5xx i nettverkskallene under gjennomgangen.

## Utvalg av testrader

Fra de 23 mulighetene velges tre som gir dekning:

- én med annonsekontakt og frist,
- én uten annonsekontakt og uten frist (tomtilstander),
- én med aktiviteter og koblede dokumenter (tidslinje og dokumentpanel).

Tilsvarende velges ett selskap med kontakter og én kontakt med aktivitet.

## Leveranse

Rapport med skjermbilder per side og bredde, punktvis pass/fail mot listen over, og en kort liste over eventuelle presentasjonsavvik. Avvik som er rene visningsfeil rettes i samme runde; alt som krever endring i datamodell eller skrivelag rapporteres i stedet for å bygges nå.
