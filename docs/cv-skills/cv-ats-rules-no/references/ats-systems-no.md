# Norske ATS-systemer

Oversikt over de tre ATS-systemene som dominerer norsk marked, og hva som
fungerer i hver enkelt.

## Webcruiter

**Eier:** Webcruiter AS (Oslo)
**Markedsandel:** ~70–80% av offentlig sektor, mye av storsamfunn og bank/finans
**Typiske kunder:** NAV, Helsedirektoratet, kommuner, Equinor, DNB (delvis), skoler og universiteter

### Hva Webcruiter tolerer

- Standard `.docx` og tekst-`.pdf` (ikke skannet PDF)
- Standard fonter: Arial, Calibri, Times New Roman, Verdana, Georgia
- Vanlige seksjonsoverskrifter: Erfaring, Arbeidserfaring, Utdanning, Utdannelse, Ferdigheter, Kompetanse
- Datoer i format `MMM ÅÅÅÅ` (`jan. 2024`), `MM.ÅÅÅÅ` (`01.2024`) eller `MM/ÅÅÅÅ`
- Norske og engelske headers blandet (men foretrekker konsistens)

### Hva Webcruiter parser feil eller filtrerer

- Innhold inne i tabeller — kolonner blir ofte slått sammen i feil rekkefølge
- Tekstbokser og frittstående tekstrammer — ofte ignorert helt
- Headers og footers — innhold der blir typisk droppet
- Ikoner som tekst (`📞`, `✉️`) — kan bryte parsing av nærliggende tekst
- Spalteoppsett — komplekst, gir uforutsigbar parsing
- Bilder som inneholder tekst (logo med navn, profilbilder med teksting)

### Anbefalt for Webcruiter

- Ren én-spalte layout
- Datoer i `MMM ÅÅÅÅ`-format med norske månedsforkortelser
- Konsistent norsk-eller-engelsk per CV (ikke blande)
- Bullets med standard `•` eller `-`

---

## Teamtailor

**Eier:** Teamtailor AB (Stockholm)
**Markedsandel:** Voksende, dominant i tech og scale-ups, mange skandinaviske selskaper
**Typiske kunder:** Storebrand (delvis), Cognite, Schibsted, mange teknologi-bedrifter

### Hva Teamtailor tolerer

- `.docx`, `.pdf` (tekst), og noen formats av rich-text
- Bredere fontstøtte enn Webcruiter
- Engelske seksjonsoverskrifter er minst like vanlig som norske
- Bedre på å bevare formatering ved import enn Webcruiter

### Hva Teamtailor parser feil

- Komplekse tabeller (samme som Webcruiter)
- Tekstbokser
- Sammensatte ikoner

### Anbefalt for Teamtailor

- Samme grunnprinsipper som Webcruiter — minste fellesnevner gir ATS-safe CV

---

## ReachMee

**Eier:** Talentech (samme konsern som flere andre nordiske ATS)
**Markedsandel:** Mindre nå, men fortsatt utbredt installert base i finans og industri
**Typiske kunder:** Storebrand, Statoil/Equinor (legacy), enkelte bankinstitusjoner

### Hva ReachMee tolerer

- Standard `.docx` og tekst-`.pdf`
- Mer konservativ parser enn de andre
- Foretrekker enklere layout

### Hva ReachMee parser feil

- Avanserte typografiske trekk (variable fonter, tight tracking)
- Spalteoppsett — verre enn Webcruiter
- Komplisert hierarki (mer enn 2 nivåer av sub-headers)

### Anbefalt for ReachMee

- Hold layout enkel og lineær
- Maks 2 hierarki-nivåer
- Ingen spaltebrudd

---

## Andre norske ATS

Disse er mindre, men finnes:

- **Recman** (Norge)
- **Jobylon** (Sverige, brukes av enkelte norske)
- **Greenhouse, Lever, Workday** (internasjonale, mest hos store globale selskaper med Norge-kontor)

Reglene som virker for de tre store, virker også for disse.

---

## Endringslogg

Bumpes når observert ATS-atferd endrer seg.

### v1.0 — 8. mai 2026
- Initial versjon basert på offentlig dokumentasjon og praktisk erfaring
- Henrik Vaage har observert Webcruiters og Teamtailors atferd i sokr-prosessen

---

## Når det oppstår tvil

Hvis vi observerer at en konkret ATS bryter en av reglene her — ved at en CV
levert av sokr.online ikke parses som forventet — skal vi:

1. Logge observasjonen i `endringslogg` over
2. Stramme inn regelen i `format-rules.md` eller `content-rules.md`
3. Bumpe `RULES_VERSION`
4. Eventuelt re-rendere eksisterende master-CV-er hvis endringen påvirker dem
