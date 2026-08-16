---
name: cv-evidence-graph
description: >
  Brukes når sokr.online / søkr.no skal lese, skrive, validere eller transformere
  CV-evidens — atomiske, brukerbekreftede fakta som danner grunnlaget for genererte
  CV-er og søknadsbrev. Triggere: "lag atom", "evidens-graf", "atom-skjema",
  "konverter til atoms", "deduplisering av CV-data", "validate CV-data", "import CV",
  "parse CV", "LinkedIn til atoms", "atom validation", "evidence graph".
  Skillen definerer atom-typene, TypeScript-typer som Edge-funksjoner og frontend
  bruker, valideringsregler, dedupliseringsstrategi, og konverteringsfunksjoner
  fra ulike kilder (LinkedIn ZIP, LinkedIn PDF, gammel CV, manuell innlegging).
  Brukes som fundament av alle andre CV-moduler i sokr.online.
---

# cv-evidence-graph

Kjernekontrakten for CV-evidens i sokr.online. Definerer hvordan brukerens
karrieredata representeres atomisk, valideres, dedupliseres og refereres
fra alle CV-relaterte moduler.

Versjon 2 legger et obligatorisk forslagstrinn foran alle AI- og importendringer:
`cv-atom-language-no -> AtomProposal -> review -> varig atom`.

Les `references/atom-types.md` for full beskrivelse av hver atom-type og
deres `structured_data`-felt før du genererer eller validerer atoms.

---

## Hvorfor denne Skill eksisterer

CV-modulen i sokr.online er bygget på prinsippet **evidence-first, generation-second**:
all AI-generert CV-tekst skal kunne spores tilbake til en bekreftet brukerfakta.
Dette eliminerer hallusinasjoner ved at AI aldri produserer påstander som ikke
finnes i evidens-grafen.

Evidens-grafen lagres i `cv_evidence_atoms`-tabellen. Hver atom er én verifisert
fakta — en rolle, en achievement, et måltall, en ferdighet. Atoms er hierarkiske:
`achievement` peker til `role` via `parent_atom_id`, og `metric` peker til
`achievement` på samme måte.

Når master-CV eller en jobbtilpasset variant rendres, leser AI-en kun atoms.
Den velger, omformulerer og rangerer — den legger aldri til nye påstander.
Provenance lagres slik at brukeren alltid kan se hvilken atom en gitt CV-bullet
stammer fra.

---

## Når du skal bruke denne Skill

Trigger Skillen når du:

- Skal lage en ny atom fra brukerinput, importert kilde, eller intervjusvar
- Skal validere en atom før den lagres
- Skal deduplisere atoms (typisk etter import fra LinkedIn ZIP eller gammel CV)
- Skal konvertere strukturert data (LinkedIn-CSV-rad, parset PDF, manuelt skjema)
  til atoms
- Skal lese atoms i en Edge-funksjon eller frontend og trenger riktig type
- Skal bekrefte (sett `user_confirmed=true`) eller låse (sett `user_locked=true`)
  en atom

Ikke trigger Skillen for ren tekstgenerering eller jobbannonse-parsing — det
hører til andre moduler.

---

## Kjernebegreper

### Atom-typer

Atomer har én av disse typene. Full beskrivelse i `references/atom-types.md`.

| Type | Hierarki | Brukes for |
|---|---|---|
| `role` | toppnivå | én stilling/jobb hos én arbeidsgiver |
| `achievement` | child av role | én konkret prestasjon i rollen |
| `metric` | child av achievement | én kvantifisert måling |
| `context` | child av role | bakgrunn om selskap/team i rollen |
| `tool` | child av role eller standalone | teknologi/verktøy brukt |
| `education` | toppnivå | én utdanningsoppføring |
| `skill` | toppnivå | én ferdighet/kompetanse |
| `language` | toppnivå | én språkkompetanse |
| `certification` | toppnivå | ett sertifikat |
| `project` | toppnivå eller child av role | ett prosjekt |
| `volunteer` | toppnivå | én frivillig rolle |
| `summary_fragment` | toppnivå | byggekloss til profilsammendrag |

### Confidence-nivåer

| Nivå | Betyr |
|---|---|
| `verified` | Brukeren har eksplisitt bekreftet eller lagt inn dette |
| `imported` | Hentet fra ekstern kilde, ikke bekreftet ennå |
| `inferred` | AI har fylt et hull med rimelig antagelse — krever bekreftelse før bruk |

Nye atoms fra import får `imported`. Manuelle atoms og atoms som er gått gjennom
review-steget får `verified`. Atoms produsert av AI-utfylling får `inferred` og
**må ikke brukes** til generering før brukeren har bekreftet dem.

AI og import skal først opprette `AtomProposal`. De skal aldri kalle CRUD-wrapperen
for varige atoms direkte. Les `references/backend-integration.md`.

### Source types

| Verdi | Kilde |
|---|---|
| `linkedin_oauth` | LinkedIn OIDC (kun navn/headline/bilde) |
| `linkedin_zip` | LinkedIn data export ZIP |
| `linkedin_pdf` | LinkedIn profile-as-PDF |
| `old_cv_pdf` | Brukerens egen gamle CV i PDF-format |
| `old_cv_docx` | Brukerens egen gamle CV i Word-format |
| `interview` | Intervju-engine (cv_interview_sessions) |
| `manual` | Manuelt skjema i CV-builder |
| `about_me_profile` | Felter fra `profiles`-tabellen via about-me-siden |
| `onboarding` | Felter fra onboarding-flyten |

### Innhold på to språk

Hver atom har `content_no` (norsk) og `content_en` (engelsk). Begge språk
kan settes ved opprettelse, eller én av dem kan settes med oversettelse til
det andre senere. Når atomen brukes i CV-rendering, velges språk som matcher
`documents.language`.

`structured_data` er språknøytral. Datoer, tall, navn på selskap/utdanning
ligger her, og deles mellom NO og EN.

---

## Bruksmønstre

### Lese atoms i en Edge-funksjon

```typescript
import { CvAtom, parseAtomRow } from "../shared/cv-evidence-graph/types.ts";

const { data } = await supabase
  .from("cv_evidence_atoms")
  .select("*")
  .eq("user_id", user_id)
  .eq("user_confirmed", true);

const atoms: CvAtom[] = (data ?? []).map(parseAtomRow);
```

### Lage en ny atom

```typescript
import { createRoleAtom, validateAtom } from "../shared/cv-evidence-graph/types.ts";

const atom = createRoleAtom({
  user_id,
  source_type: "manual",
  structured_data: {
    employer: "Cisco Systems Norge",
    title: "COO",
    start_date: "2019-01",
    end_date: "2024-06",
    location: "Oslo",
    is_current: false,
  },
  content_no: "Operasjonell direktør for Cisco Norge…",
  content_en: "Chief Operating Officer for Cisco Norway…",
});

const validation = validateAtom(atom);
if (!validation.ok) throw new Error(validation.error);

await supabase.from("cv_evidence_atoms").insert(atom);
```

### Deduplisere etter import

```typescript
import { findDuplicates, mergeAtoms } from "../shared/cv-evidence-graph/deduplicate.ts";

const newAtoms = parsedFromLinkedIn;       // atoms from import
const existingAtoms = await fetchUserAtoms(user_id);

const dupes = findDuplicates(newAtoms, existingAtoms);

for (const { incoming, existing } of dupes) {
  const merged = mergeAtoms(existing, incoming);   // beholder mest detaljert
  await supabase.from("cv_evidence_atoms").update(merged).eq("id", existing.id);
}

const uniques = newAtoms.filter(a => !dupes.find(d => d.incoming.id === a.id));
await supabase.from("cv_evidence_atoms").insert(uniques);
```

### Konvertere fra LinkedIn ZIP

```typescript
import { linkedinPositionRowToRoleAtoms } from "../shared/cv-evidence-graph/converters/linkedin-zip.ts";

const positions = parseLinkedInPositionsCsv(csvText);
for (const row of positions) {
  const { role, achievements, context } = linkedinPositionRowToRoleAtoms(row, user_id);
  await insertAtomTree([role, ...achievements, context]);
}
```

---

## Hva denne Skill IKKE gjør

- Ikke render Word/PDF — det er `cv-ats-rules-no` Skill
- Ikke verifiser AI-output mot atoms — det er `cv-hallucination-guard` Skill
- Ikke språkpolish norsk tekst — det er `cv-quality-no` Skill
- Ikke parser jobbannonser — det er `extract-job-ad` Edge-funksjon
- Ikke ranger atoms til søknad — det er CV-tailoring (Lovable-modul)

---

## Filer i denne Skillen

| Fil | Innhold |
|---|---|
| `SKILL.md` | Denne filen |
| `references/atom-types.md` | Detaljert beskrivelse av hver atom-type og structured_data |
| `references/validation-rules.md` | Alle valideringsregler |
| `references/deduplication-strategy.md` | Dedupliseringsstrategi per atom-type |
| `scripts/types.ts` | TypeScript-typer for atoms — kopier til Edge-funksjon eller frontend |
| `scripts/validators.ts` | Valideringsfunksjoner |
| `scripts/deduplicate.ts` | Dedupliseringsfunksjoner |
| `scripts/crud.ts` | Supabase CRUD-wrappers |
| `scripts/converters/linkedin-zip.ts` | LinkedIn ZIP-rader → atoms |
| `scripts/converters/linkedin-pdf.ts` | Parset LinkedIn PDF → atoms |
| `scripts/converters/old-cv.ts` | Parset gammel CV → atoms |
| `scripts/converters/profile-fields.ts` | profiles-felter → atoms |

Når en Edge-funksjon trenger denne Skillen, kopierer Lovable filene fra
`scripts/` til `supabase/functions/_shared/cv-evidence-graph/`. Frontend kan
importere fra `src/lib/cv-evidence-graph/`.

---

## Versjonering og endring

Hovedversjon endres når atom-skjemaet endres på en bakoverinkompatibel måte
(slettet felt, endret type på `structured_data`-felt). Endringer her krever
migrasjon av eksisterende atoms. Marker tydelig hvilken versjon TypeScript-typene
matcher. Skillens versjon står i `references/atom-types.md`.

---

*Skill-versjon 2.0.0 - atomskjema 1.1 - 16. august 2026*
