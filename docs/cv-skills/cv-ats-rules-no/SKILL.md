---
name: cv-ats-rules-no
description: >
  Brukes når sokr.online / søkr.no skal generere, validere eller eksportere CV
  for det norske jobbmarkedet. Triggere: "ATS-regler", "ATS-vennlig CV", "norsk
  CV-format", "Webcruiter", "Teamtailor", "ReachMee", "render CV", "eksporter CV
  til docx", "valider CV mot ATS", "CV-format Norge", "headers på norsk CV",
  "datoformat CV", "ATS validation", "ATS rules". Skillen definerer hvilke
  seksjoner, headers, datoformat, tegnsetting, fonter og layout som er trygt
  for de tre dominerende ATS-systemene i Norge, pluss GDPR-regler for hva som
  ikke skal stå i en norsk CV. Inkluderer TypeScript-validatorer som kjøres
  før eksport, og konstanter som CV-rendering-koden importerer direkte.
---

# cv-ats-rules-no

Regelmotor for ATS-vennlig CV-generering og -eksport i norsk kontekst.

Versjon 2 skiller uttrykkelig mellom ATS-kompatibilitet og jobb-relevans.
Formatvalidering og nøkkelorddekning er to resultater, og manglende krav skal
vises som et gap - aldri fylles med oppdiktet erfaring.

Skillen brukes av to ting i sokr.online: rendering-pipelinen (hva som faktisk
skrives ut), og en validator som kjører før eksport for å fange brudd.

Les `references/ats-systems-no.md` for oversikt over hvilke ATS-systemer som
dominerer norsk marked. Les `references/format-rules.md` for tekniske regler,
`references/content-rules.md` for innholdsregler, og
`references/gdpr-personvern.md` for personvern.

---

## Hvorfor denne Skill eksisterer

Et "ATS" (Applicant Tracking System) er programvaren som tar imot
CV-er fra søkere, lagrer dem strukturert, og leverer dem til hiring managers.
Hvis CV-en din ikke kan parses korrekt av ATS-en, blir kandidatdataene mangelfull
eller fraværende — uavhengig av hvor god kandidaten faktisk er.

Norsk marked domineres av tre ATS:

| ATS | Markedsandel (anslag) | Typiske kunder |
|---|---|---|
| Webcruiter | ~70–80% av offentlig sektor og store private | NAV, Helsedirektoratet, Equinor, kommuner, banker |
| Teamtailor | Voksende i tech og scale-ups | DNB, Storebrand, mange Vekstbedrifter |
| ReachMee (Talentech) | Eldre, men fortsatt utbredt i finans og industri | Mindre, men aktiv installert base |

Disse systemene har ulike toleranser for layout, men reglene som virker for
**alle tre** er det vi koder mot. Vi optimerer for "minste fellesnevner" —
en CV som virker i Webcruiter virker også i Teamtailor og ReachMee.

---

## Hvordan Skill-en brukes

### 1. Som kontrakt for rendering

`scripts/ats-rules.ts` eksporterer konstanter som CV-rendering-koden importerer:

```typescript
import {
  ATS_SAFE_FONTS,
  ATS_SAFE_SECTIONS,
  ATS_SAFE_DATE_FORMAT_NO,
  SECTION_HEADERS_NO,
} from "../shared/cv-ats-rules-no/ats-rules.ts";
```

### 2. Som validator før eksport

```typescript
import { validateCvDraft } from "../shared/cv-ats-rules-no/ats-rules.ts";

const result = validateCvDraft(draft);

if (result.violations.length > 0) {
  // Stopp eksport og rapporter til brukeren
  return { error: "ATS_VALIDATION_FAILED", violations: result.violations };
}
```

### 3. Når Claude skal komponere CV-tekst

Når CV-modulen ber Claude generere en bullet eller summary, skal Claude lese
denne Skill-en først og følge:

- Norsk datoformat (`jan. 2024`, ikke `01/2024` eller `Jan 2024`)
- Norske seksjonstitler (`Erfaring`, `Utdanning`, ikke `Experience`, `Education`)
- Ingen ikoner i tekst, ingen tabeller, ingen tekstbokser
- Maks 2 nivåer av hierarki
- Bullet-tegn skal være standard `•` eller `-`, ikke spesialtegn

---

## Kjernebegreper

### "ATS-safe" vs "ATS-optimal"

- **ATS-safe** = vil bli korrekt parset av Webcruiter, Teamtailor og ReachMee. Dette er minimumskravet og det vi alltid leverer.
- **ATS-optimal** = bruker keyword-matching, riktig sektion-heading-matching, og struktur som maksimerer scoring i ATS-en. Dette håndteres av tailoring-modulen, ikke her.

### Validation severity

Hver regel-overtredelse har en alvorlighetsgrad:

| Severity | Betyr | Konsekvens |
|---|---|---|
| `error` | CV-en blir parset feil eller filtrert ut | Stopp eksport |
| `warning` | Risiko for parser-feil i kant-tilfeller | Vis advarsel, la brukeren velge |
| `info` | Kan optimeres, ikke kritisk | Logg, ingen brukerstopp |

### Hva er IKKE her

- Innholdsregler (hva som er en god achievement) — det er `cv-quality-no`
- Verifisering at AI-tekst stemmer med atoms — det er `cv-hallucination-guard`
- Faktisk filgenerering (docx/pdf-bytes) — det er edge-funksjonen `render-cv`
- Jobbtilpasning og keyword-matching — det er Lovable-modulen for CV-tailoring

Jobbtilpasningsmodulen skal likevel bruke `evaluateKeywordCoverage()` fra denne
skillen som kontrakt. Den avgjør dekning, men skriver ikke CV-tekst.

### Backend og Claude

Les `references/backend-integration.md`. Claude kan formulere et støttet
nøkkelord naturlig, men kan ikke opprette støtte eller skjule et kompetansegap.

---

## Filer i denne Skillen

| Fil | Innhold |
|---|---|
| `SKILL.md` | Denne filen |
| `references/ats-systems-no.md` | De tre ATS-ene, hva de tolererer og ikke |
| `references/format-rules.md` | Tekniske regler (fil, font, dimensjoner) |
| `references/content-rules.md` | Innholdsregler (seksjoner, headers, datoer, lengde) |
| `references/language-rules-no.md` | Norsk-spesifikt (æøå, datoformat, tall) |
| `references/gdpr-personvern.md` | Hva som IKKE skal være i en norsk CV |
| `scripts/types.ts` | CvDraft, AtsViolation, AtsCheckResult |
| `scripts/ats-rules.ts` | Konstanter og hovedvalidator |
| `scripts/validators/format-validator.ts` | Filformat, font, dimensjoner |
| `scripts/validators/content-validator.ts` | Seksjoner, headers, datoer, lengde |
| `scripts/validators/language-validator.ts` | Norske språk-regler |
| `scripts/validators/gdpr-validator.ts` | Personvern-regler |

---

## Versjonering

ATS-systemenes parsere oppdateres jevnlig. Når en regel her endres på grunn
av observert ATS-atferd, bumper vi `RULES_VERSION` i `scripts/ats-rules.ts`
og dokumenterer endringen i en egen seksjon i `references/ats-systems-no.md`.

---

*Skill-versjon 2.0.0 - 16. august 2026*
