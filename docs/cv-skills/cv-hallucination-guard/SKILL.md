---
name: cv-hallucination-guard
description: >
  Brukes når sokr.online / søkr.no skal verifisere at AI-generert CV-tekst eller
  søknadsbrev-tekst kan spores tilbake til atoms i evidens-grafen. Triggere:
  "verifiser CV", "sjekk hallusinasjon", "evidens-sjekk", "claim verification",
  "sjekk om AI-tekst er støttet", "ground AI-output", "fact-check CV", "verify
  against atoms", "hallucination check", "guard CV". Skillen definerer hva som
  regnes som en påstand (hard claim vs soft claim), hvordan AI-output ekstraheres
  og matches mot atoms, og hvordan resultatet returneres til CV-bygger eller
  Edge-funksjon. Brukes som siste pass før eksport eller før AI-tekst presenteres
  for brukeren.
---

# cv-hallucination-guard

Verifier-pass mot evidens-grafen. Hindrer at AI fabrikkerer fakta som ikke
finnes i atoms.

Versjon 2 bruker bare eksplisitt kvalifisert evidens og validerer at Claude
kun viser til atoms den faktisk fikk. Norske parafraser kan godtas, men
styrkegrad og eierskap må være identisk eller svakere enn kilden.

Les `references/claim-types.md` for hva som regnes som en hard vs soft claim.
Les `references/verification-strategy.md` for hvordan to-passes-verifikasjon
fungerer (rule-based pluss LLM-judge). Les `references/failure-modes.md` for
vanlige måter AI hallusinerer i CV-kontekst.

---

## Hvorfor denne Skill eksisterer

Sokr.online sin kjernetillit hviler på prinsippet **evidence-first,
generation-second** definert i `cv-evidence-graph`: all AI-generert CV-tekst
skal kunne spores til en atom som brukeren har bekreftet.

I praksis vil AI noen ganger:

- Avrunde tall ("USD 45 mill." → "rundt 50 mill.")
- Gjenspeile mønster fra andre CV-er ("vekst" når det egentlig var "stabilitet")
- Ekstrapolere ("ledet team" → "ledet team på over 50 personer")
- Fabrikke kontekst ("rapporterte til CEO" når dette ikke står noe sted)
- Forvirre selskapsnavn (sammenblanding av to roller)

Denne Skill-en fanger slik drift før output presenteres til brukeren eller
eksporteres til ATS.

---

## Når brukes Skill-en

Kjør alltid på den endelige teksten etter `cv-quality-no`. Enhver omskriving
kan endre påstander og ugyldiggjør et eldre guard-resultat.

### I Edge-funksjon `match-assessment` eller `generate-cover-letter`

Etter at Claude API har generert CV-tekst, kjører Edge-funksjonen
`verifyAgainstAtoms()` på output. Hvis verifikasjonen feiler, kan Edge-funksjonen:

1. Returnere feilmelding til frontend (brukeren ser hva som ikke kan verifiseres)
2. Kjøre regenerering med strengere instruks
3. Markere bullet som "ubekreftet" i UI

### I CV-builder

Når brukeren manuelt redigerer en bullet, kan UI-en kjøre lettvekts-verifikasjon
mot atoms (kun hard claims) for å fange tall-feil i sanntid.

### Under intervju-engine

Når intervju-engine genererer foreslåtte bullets basert på brukerens svar, må
disse passere gjennom guard før de presenteres som "ferdig formulering".

---

## Kjernekonsepter

### Claim

En **claim** er en spesifikk påstand i tekst som potensielt kan være sann eller
usann. Eksempler fra en CV-bullet:

> Etablerte Symantec Norge fra null til USD 45 mill. omsetning og 27 ansatte i løpet av 5 år.

Claims i denne setningen:

| Type | Innhold |
|---|---|
| Selskap | "Symantec Norge" |
| Hard fakta | "fra null" (nylansering) |
| Hard fakta | "USD 45 mill." (omsetning) |
| Hard fakta | "27 ansatte" (team-størrelse) |
| Hard fakta | "5 år" (varighet) |
| Soft påstand | "etablerte" (handling-rolle) |

Hard claims krever eksakt match. Soft claims krever semantisk match.

### Hard claim vs soft claim

| Type | Kjennetegn | Verifikasjon |
|---|---|---|
| **Hard** | Tall, datoer, navngitte enheter, prosenter, beløp | Eksakt match mot atoms |
| **Soft** | Beskrivende verb og setninger, kontekstuelle påstander | Semantisk match (LLM-judge) |

### Verification result

Hver claim får en av disse statusene:

| Status | Betyr |
|---|---|
| `verified` | Match funnet i atoms med høy konfidens |
| `partial` | Lignende fakta finnes, men avviker (f.eks. avrundet tall) |
| `unverified` | Ingen match funnet |
| `contradicted` | Atom motsier påstanden |

`unverified` og `contradicted` er **blokker** — output må regenereres eller
brukeren må eksplisitt godkjenne.

---

## Hvordan Skill-en kalles

### Lettvekts (kun hard claims, raskt)

```typescript
import { verifyAgainstAtoms } from "../shared/cv-hallucination-guard/guard.ts";

const result = verifyAgainstAtoms(generatedText, userAtoms, { mode: "fast" });
if (result.unverified.length > 0) {
  // Stopp eller flagg
}
```

### Full (hard + soft, krever Claude API)

```typescript
import { verifyAgainstAtomsFull } from "../shared/cv-hallucination-guard/guard.ts";

const result = await verifyAgainstAtomsFull(
  generatedText,
  userAtoms,
  { anthropicApiKey: env.ANTHROPIC_API_KEY }
);
```

Den fulle versjonen kaller en LLM-judge med en kontrollert prompt som vurderer
soft claims mot atoms helhetlig.

---

## Hva denne Skill IKKE gjør

- Ikke generer ny tekst — den verifiserer eksisterende
- Ikke språkrenser eller kvalitets-vurderer — det er `cv-quality-no`
- Ikke validerer ATS-kompatibilitet — det er `cv-ats-rules-no`
- Ikke endrer atoms i evidens-grafen — read-only

For Lovable/Claude-implementasjon, les `references/backend-integration.md`.

---

## Filer i denne Skillen

| Fil | Innhold |
|---|---|
| `SKILL.md` | Denne filen |
| `references/claim-types.md` | Definisjoner av claim-typer og hvordan de matches |
| `references/verification-strategy.md` | To-passes verifikasjons-strategi |
| `references/failure-modes.md` | Vanlige hallusinasjons-mønstre |
| `scripts/types.ts` | Claim, ClaimMatch, GuardResult, AtomLike |
| `scripts/extractors/number-extractor.ts` | Trekk ut tall, beløp, prosent |
| `scripts/extractors/date-extractor.ts` | Trekk ut datoer og tidsperioder |
| `scripts/extractors/entity-extractor.ts` | Trekk ut selskaps- og institusjonsnavn |
| `scripts/extractors/claim-extractor.ts` | Hovedmotor for claim-uttrekk |
| `scripts/matchers/exact-matcher.ts` | Eksakt-match mot atom-data |
| `scripts/matchers/semantic-matcher.ts` | Lettvekts semantisk match (uten LLM) |
| `scripts/llm-judge.ts` | Claude-prompt for soft-claim-vurdering |
| `scripts/guard.ts` | Hovedmotor: verifyAgainstAtoms() og verifyAgainstAtomsFull() |

---

*Skill-versjon 2.0.0 - 16. august 2026*
