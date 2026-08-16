# Format-regler

Tekniske regler for hvordan CV-filen skal være bygget. Disse reglene
gjelder for filer som genereres av sokr.online for opplasting til ATS.

## Filformat

| Format | Status | Bruk |
|---|---|---|
| `.docx` | **Foretrukket** | Standard eksport. Mest robust på tvers av ATS. |
| Tekst-PDF | OK | Eksport for visuell deling og forhåndsvisning. ATS-safe så lenge teksten er tekst (ikke bilde). |
| Skannet PDF | **Forbudt** | Bilder uten tekst-lag — parses ikke. Vi genererer aldri dette. |
| `.doc` (gammel Word) | Forbudt | Eldre format, dårlig støtte i moderne ATS. Vi bruker bare `.docx`. |
| `.pages` | Forbudt | Apple-eksklusivt. Mange ATS støtter ikke. |
| `.txt` | OK som eksport-bonus | Mister all formatering. Kun for tekst-fokuserte ATS-er. |
| `.rtf` | Forbudt | Inkonsistent rendering. |

## Fonter

### ATS-trygge fonter

| Font | Anbefalt størrelse for brødtekst |
|---|---|
| Arial | 10–11 pt |
| Calibri | 11 pt |
| Helvetica | 10–11 pt |
| Times New Roman | 11–12 pt |
| Georgia | 11 pt |
| Verdana | 10 pt |

For headers kan brukes 12–14 pt (samme font, fet).

### Forbudt

- Variable fonter (TT-fonter med vekt-akser)
- Display-fonter for brødtekst
- Egendefinerte/bedrifts-fonter (kan rendres som "missing font" i ATS)
- Cursive/handwriting-fonter
- Symbol-fonter

## Marg og layout

- **Margin:** 1.5–2.5 cm på alle kanter (A4-format)
- **Linjeavstand:** 1.0–1.15 (singel eller knapt over)
- **Spalter:** Én. Aldri to-spaltet eller mer.
- **Tabeller:** Aldri.
- **Tekstbokser:** Aldri.
- **Headers/footers:** Tom. Sidetall i footer er OK, men ingen viktig informasjon der.

## Bilder og grafikk

- **Profilbilde:** Tillatt, men plasseres slik at det ikke bryter tekstflyt. Aldri som element som teksten flyter rundt. Best er ingen profilbilde — det er ikke skikk i norsk CV-tradisjon for de fleste yrker, og det reduserer ATS-parsing-risiko.
- **Logoer:** Aldri i CV-en. Disse hører hjemme i søknadsbrev hvis nødvendig.
- **Ikoner:** Ingen i tekst. Ingen som dekorative element ved siden av seksjonsoverskrifter heller.
- **Diagrammer/grafikk:** Aldri.

## Tegn og spesialtegn

| Bruk | Status |
|---|---|
| Vanlige bokstaver, tall, tegnsetting | OK |
| Norsk æ/ø/å | OK (bruk UTF-8) |
| `•` (bullet) | OK |
| `-` (vanlig bindestrek) | OK |
| `–` (en dash, brukes for tidsperioder: "2019–2024") | OK |
| `—` (em dash) | OK i prosa, men bruk sparsomt |
| Anførselstegn `"` `"` `«` `»` | OK |
| Emoji | Forbudt |
| Symbol-ikoner (`📞` `✉️` `🔗`) | Forbudt |
| Matematiske symboler (`±`, `≥`) | Bruk med forsiktighet — kan ødelegge parsing |
| Pre-formatert tekst med mellomrom for layout | Forbudt — ATS bryter dette |

## Filnavn-konvensjon

Filnavn for eksport bør være:

```
CV_Henrik_Vaage_NO.docx
CV_Henrik_Vaage_EN.docx
CV_Henrik_Vaage_<jobbtittel>.docx     # for jobbtilpassede varianter
Soknad_Henrik_Vaage_<selskap>.docx    # for søknadsbrev
```

Regler:
- Ingen mellomrom (bruk `_`)
- Ingen norske spesialtegn i filnavn (æ→a, ø→o, å→a) — for å unngå koding-problemer ved opplasting
- Ingen `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`
- Maks ~80 tegn totalt

## Sidelengde

- **Junior/midlertid:** 1 side
- **Senior/erfaren:** 1–2 sider
- **Executive (10+ års erfaring):** 2–3 sider, sjelden mer
- **Akademisk (CV med publikasjoner):** ingen øvre grense, men sjelden i ATS-kontekst

CV-er over 3 sider blir ofte truncert i forhåndsvisninger og kan ikke bli lest
fullstendig. Selv om ATS-en parser dem, kan rekrutterer hoppe over senere sider.

## Encoding

- **UTF-8** alltid. Aldri Latin-1 eller annen single-byte encoding.
- Filnavn i UTF-8 så langt mulig (men bytt ut æøå i selve filnavnet — se over).

## Komprimering

- Ikke pakk CV-er i ZIP når brukeren laster opp til ATS. ATS-er parser ikke ZIP-innhold.
- Ikke krypter PDF-er. ATS-er kan ikke åpne dem.
