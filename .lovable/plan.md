
# Plan: Skill v1.3.2 — cover-lås + versjonert kildekode

Mål: fikse cover-formateringen som Claude improviserer, og samtidig flytte skill-kilden inn i Git slik at fremtidige endringer er enkle å gjøre og review-bare. Brukerflyten endres ikke — fortsatt én `.skill`-fil å laste ned og dobbeltklikke.

## Hva som leveres

### 1. Versjonert skill-kilde i repoet (valg B)
Ny mappe `skill-src/employer-analysis/` som inneholder alle skill-filer som plain tekst (pakket ut fra dagens `skill-bundle.ts`):
```
skill-src/employer-analysis/
├── SKILL.md
├── assets/
│   ├── template_standard.html
│   ├── template_extended.html
│   ├── styles.css
│   ├── logo.svg
│   └── logo-footer.svg
├── scripts/
│   └── render_report.py
├── references/
│   ├── scoring_rubric.md
│   ├── report_methodology.md
│   ├── language_codes.md
│   └── extended_report_outline.md
└── tests/
    └── test_language_consistency.py
```

### 2. Build-script som regenererer bundlen
Ny `scripts/build-skill.mjs` som:
- leser `skill-src/employer-analysis/` rekursivt
- kjører `python3 tests/test_language_consistency.py` for å validere
- zip-er mappa til `employer-analysis-v1.3.2.skill`
- base64-koder den
- skriver ny `src/server/skill-bundle.ts` med oppdatert `SKILL_FILENAME` + `SKILL_BASE64`

Kjøres manuelt med `node scripts/build-skill.mjs` etter endringer. Resultatet (oppdatert `skill-bundle.ts`) committes sammen med kildeendringene, så download-endepunktet fungerer uten kjøretidsbygging.

### 3. Cover-template hardlås (valg A — kjernen i fiksen)
Endringer i `skill-src/employer-analysis/assets/template_standard.html`:
- Cover-seksjonen blir selvforsynt med fast logo-plassering (`{{LOGO_SVG}}`, 320 px bredde, sentrert), klart vertikalt rytme mellom `.cover-company` (h1) og `.cover-entity` (undertittel).
- Eksplisitt fallback: hvis `{{LOGO_SVG}}` mangler, vis brand-tekst "KarrierenMin" i merkefont.
- Fjern alle meta-felter Claude pleier å legge til på cover (Rapportnivå, Søk utført, score-bobler). Cover skal kun ha: logo, firmanavn, entitetslinje, dato, rapport-ID.
- Flytt de blå bånd-stilene inn i `styles.css` som faste klasser (`.cover-band-top`, `.cover-band-bottom`) — ingen inline-CSS.
- Marker hele cover-blokken med HTML-kommentar: `<!-- COVER: DO NOT MODIFY. Edit template_standard.html in skill source. -->`

### 4. SKILL.md Steg 5 oppgraderes til MANDATORY
- Endre overskrift fra "Step 5: Render PDF" til "Step 5 (MANDATORY): Render PDF using bundled template — DO NOT improvise".
- Eksplisitte forbud: ingen redigering av `template_standard.html`/`styles.css`, ingen egendefinert cover, ingen scores på cover, ingen ekstra meta-felter, ingen inline-CSS.
- Eksplisitt krav: `pip install weasyprint` må kjøres; markdown→PDF-fallback er ikke tillatt.
- Sjekkliste på slutten av Steg 5 som Claude må verifisere før levering (logo synlig, firmanavn over entitet, ingen score på cover, footer "Page N").

### 5. render_report.py — fail-fast og diagnostikk
- Legg til `_assert_cover_assets()` som verifiserer at `logo.svg` og `logo-footer.svg` finnes før WeasyPrint kalles; kaster tydelig feil ellers.
- Logg WeasyPrint-versjon og full output-path til stdout.
- Hvis `weasyprint` ikke kan importeres: kast `RuntimeError` med teksten "Run: pip install weasyprint" — ingen stille fallback.

### 6. Versjonsbump
- `SKILL.md` frontmatter `version: 1.3.2`
- `SKILL_FILENAME = "employer-analysis-v1.3.2.skill"`
- Nytt CHANGELOG-entry i `SKILL.md` som forklarer cover-låsen.

## Teknisk

| Komponent | Endring |
|---|---|
| `skill-src/employer-analysis/**` | NY — utpakket fra dagens base64 i `skill-bundle.ts` |
| `scripts/build-skill.mjs` | NY — zip + base64 + skriv `skill-bundle.ts` |
| `package.json` | Legg til script `"build:skill": "node scripts/build-skill.mjs"` |
| `skill-src/.../assets/template_standard.html` | Cover-seksjon skrives om (logo, vertikalt rytme, ingen meta, fast fallback) |
| `skill-src/.../assets/styles.css` | Nye `.cover-band-top`/`.cover-band-bottom`-klasser |
| `skill-src/.../SKILL.md` | Steg 5 → MANDATORY + sjekkliste; versjon 1.3.2; CHANGELOG |
| `skill-src/.../scripts/render_report.py` | `_assert_cover_assets`, versjonsloggning, hard feil uten weasyprint |
| `src/server/skill-bundle.ts` | Regenereres av build-scriptet (ny base64 + filnavn) |
| `src/routes/api/public/selskapsanalyse/download.ts` | Ingen endring — bruker `SKILL_FILENAME`/`SKILL_BASE64` |

## Brukerflyt etter deploy
1. Last ned `employer-analysis-v1.3.2.skill` fra karrierenmin.no (samme knapp som før).
2. Dobbeltklikk → Claude spør "Replace existing skill?" → Ja.
3. Ferdig. Neste rapport bruker den låste cover-templaten.

## Ut av scope
- TanStack-appen, databasen, e-post og ingest-endepunktet røres ikke.
- Ingen endringer i `template_extended.html` utover å speile cover-låsen hvis det er nødvendig (vurderes når kildefilene er pakket ut).
