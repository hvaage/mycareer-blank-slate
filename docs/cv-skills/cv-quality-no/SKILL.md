---
name: cv-quality-no
description: >
  Brukes når sokr.online / søkr.no skal vurdere eller forbedre språkkvalitet
  i AI-generert eller manuelt skrevet CV-tekst på norsk. Triggere: "sjekk
  språk", "forbedre formulering", "fange AI-fraser", "språkkvalitet", "verb-styrke",
  "klisjeer", "rewrite bullet", "polish CV", "finishing pass", "tonekvalitet",
  "norsk CV-stil", "skrivestil CV". Skillen sjekker for svake åpningsverb,
  passive konstruksjoner, inkonsistent verb-tid, overdrevne adjektiver,
  AI-typiske klisjéer, generisk fluff, for lange setninger og repetitive
  formuleringer. Brukes før hallusinasjonsvakt og ATS-pass, og kan også gi
  evidensbundne forbedringsforslag til hver bullet.
---

# cv-quality-no

Norsk språkkvalitets-vurderer for CV-bullets, profilsammendrag og søknadsbrev.

Versjon 2 gjør rewrites evidensbundne. Claude må returnere hvilke atoms og
påstander teksten bygger på, og enhver rewrite må valideres og deretter kjøres
gjennom `cv-hallucination-guard`.

Les `references/tone-and-style.md` for stilprinsippene som styrer hva som regnes
som god norsk CV-prosa. Les `references/ai-tells.md` for klisjéer og fraser
som avslører maskinell opphav. Les `references/strong-verbs.md` for verb-tabell
med svake → sterke alternativer. Les `references/readability.md` for setningslengde
og leselighet.

---

## Hvorfor denne Skill eksisterer

`cv-evidence-graph` sikrer at fakta er korrekte. `cv-hallucination-guard`
sikrer at AI-output ikke fabrikkerer fakta. `cv-ats-rules-no` sikrer at
formatet er ATS-trygt.

Denne Skill-en sikrer at **språket er bra**.

En CV kan være faktuelt korrekt og ATS-vennlig, men likevel virke
mediokert hvis språket er:

- Generisk ("med fokus på resultater og kontinuerlig forbedring")
- Passivt ("ble etablert" i stedet for "etablerte")
- Svakt-startet ("Var ansvarlig for…", "Bidro til…")
- Overdrevent ("dynamisk", "passionate", "exceptional")
- AI-aktig ("transformerte landskapet", "datadreven")
- Inkonsistent (blander preteritum og presens)

Disse problemene er vanlige i AI-genererte CV-er og dyktige til å passere
under cv-hallucination-guard fordi de er stilistiske, ikke faktuelle.

---

## Hva Skill-en sjekker

### 1. Verb-styrke (`verb-strength.ts`)

Hvert bullet skal åpne med et sterkt, aktivt verb i preteritum (eller presens
for nåværende rolle). Svake åpninger flagges:

| Svakt | Sterkere alternativ |
|---|---|
| `Var ansvarlig for…` | `Ledet`, `Drev`, `Eide` |
| `Hjalp til med…` | (vurder å fjerne — kan signalere mindre eierskap) |
| `Bidro til…` | (samme som over — bruk konkret verb hvis kandidaten faktisk drev) |
| `Var involvert i…` | (vurder konkret rolle: "designet", "implementerte") |
| `Jobbet med…` | (for vagt — bytt til konkret handling) |

### 2. Verb-tid-konsistens (`tense-consistency.ts`)

- **Tidligere roller:** alle bullets i preteritum
- **Nåværende rolle:** alle bullets i presens (eller preteritum hvis det er om en konkret prestasjon i fortid)
- Ingen blanding innenfor samme rolle
- Aldri infinitiv som åpning (`Å bygge…`)

### 3. AI-tells (`ai-tells.ts`)

Mønstre som typisk dukker opp i AI-generert tekst og som virker generiske:

- "har spilt en avgjørende rolle"
- "transformerte landskapet"
- "i tråd med strategiske målsettinger"
- "med fokus på resultater og kontinuerlig forbedring"
- "gjennom datadreven beslutningsproses"
- "robust og skalerbar"
- "på tvers av siloer"
- "skapt verdi"

### 4. Overdrevne adjektiver (`cliches.ts`)

- "dynamisk", "innovativ", "passionate"
- "exceptional", "outstanding", "talented"
- "world-class", "cutting-edge", "best-in-class"

### 5. Setningslengde (`readability.ts`)

- Bullets: maks 25 ord per linje, ideelt 12–18
- Profilsammendrag: ingen setning over 30 ord
- Advarsel når kompleks subordinasjon (mange `som`/`at`-leddsetninger)

### 6. Repetisjon (`repetition.ts`)

- Samme verb gjentatt i flere bullets innen samme rolle
- Samme adjektiv brukt mer enn 2 ganger i hele CV-en
- Samme bullet-struktur i flere bullets på rad

### 7. Stilistisk inkonsistens

- Blanding av førsteperson ("Jeg ledet…") og upersonlig ("Ledet…") innen samme CV
- Blanding av norsk og engelsk i samme CV (mer enn aksepterte fagtermer)

---

## Severity-nivåer

| Severity | Betyr | Stopper eksport |
|---|---|---|
| `critical` | Brudd på kjerneprinsipp (f.eks. AI-tell som "transformerte landskapet") | Anbefalt blokk, men ikke obligatorisk |
| `important` | Svak formulering som tydelig kan forbedres (svake verb) | Vis advarsel |
| `minor` | Stilistiske preferanser (lange setninger, repetisjon) | Vis info |

---

## Hvordan Skill-en kalles

```typescript
import { checkQuality, suggestRewrite } from "../shared/cv-quality-no/quality.ts";

const issues = checkQuality(bulletText, { language: "no", context: "achievement" });
// issues: QualityIssue[]

if (issues.some(i => i.severity === "critical")) {
  // Vis brukeren feilene før eksport
}

// Valgfritt: be om forbedringsforslag (krever Claude API)
const rewritten = await suggestRewrite(bulletText, issues, claudeClient);
```

Edge-funksjoner kan kalle `checkQuality()` synkront (ingen LLM nødvendig).
`suggestRewrite()` krever LLM-kall.

---

## Hva denne Skill IKKE gjør

- Ikke verifiser fakta — det er `cv-hallucination-guard`
- Ikke ATS-validering — det er `cv-ats-rules-no`
- Ikke generer ny CV fra atoms — det er CV-tailoring (Lovable-modul)
- Ikke språkvask grammatikk eller skrivefeil utover det som listet — bruk en grammatikk-modul (LanguageTool eller lignende) i tillegg
- Ikke normaliser norske sammensatte ord til atomkonsepter — bruk `cv-atom-language-no`

For Lovable/Claude-implementasjon, les `references/backend-integration.md`.

---

## Filer i denne Skillen

| Fil | Innhold |
|---|---|
| `SKILL.md` | Denne filen |
| `references/tone-and-style.md` | Stilprinsipper for norsk CV-prosa |
| `references/ai-tells.md` | Liste over AI-typiske klisjéer å fange |
| `references/strong-verbs.md` | Verb-tabell: svake → sterke alternativer |
| `references/readability.md` | Setningslengde og leselighet |
| `scripts/types.ts` | QualityIssue, QualityCheckResult, RewriteRequest |
| `scripts/checks/verb-strength.ts` | Sjekk for svake åpningsverb |
| `scripts/checks/tense-consistency.ts` | Sjekk for konsistent verb-tid |
| `scripts/checks/ai-tells.ts` | Sjekk for AI-typiske mønstre |
| `scripts/checks/cliches.ts` | Sjekk for overdrevne adjektiver og fluff |
| `scripts/checks/readability.ts` | Sjekk for setningslengde |
| `scripts/checks/repetition.ts` | Sjekk for repetisjon |
| `scripts/quality.ts` | Hovedmotor: checkQuality() og suggestRewrite() |

---

*Skill-versjon 2.0.0 - 16. august 2026*
