---
name: cv-atom-language-no
description: Normaliser og fortolk norsk CV-språk før atomisering, særlig sammensatte ord, nominaliseringer, underforståtte relasjoner og semantisk like formuleringer. Bruk ved parsing av norsk CV, LinkedIn-tekst eller intervjusvar; ved forslag til atomkandidater; og ved semantisk deduplisering som må forstå at uttrykk som «skapte ledelseskultur» og «skapte en kultur rundt ledelse» beskriver samme mulige element. Skillen foreslår normalisering med kildebelegg og usikkerhet, men tilfører aldri fakta og skriver aldri varige atoms direkte.
---

# Norsk semantikk for CV-atoms

Plasser denne skillen først i CV-pipelinen:

`kildetekst -> norsk normalisering -> atomforslag -> brukerreview -> varige atoms`

Målet er semantisk forståelse, ikke språkvask. Bevar alltid originalteksten.

## Ufravikelige regler

1. Ikke legg til handling, ansvar, resultat, tall, dato, omfang eller eierskap som ikke står i kilden.
2. Ikke oppgrader «bidro til» til «ledet», «ansvar for» til «gjennomførte» eller teamresultat til individuell prestasjon.
3. Returner kandidatforslag. Ikke opprett, oppdater, slå sammen eller bekreft atoms direkte.
4. Knyt hvert forslag til eksakt kildetekst og tegnposisjon når posisjon er tilgjengelig.
5. Skill sikker ekvivalens fra mulig slektskap. Bruk `equivalent`, `related`, `distinct` eller `uncertain`.
6. Bevar sammensatte norske fagord når de er presise. Normaliser dem semantisk; ikke skriv dem mekanisk om i sluttteksten.
7. Ved tvil: returner `needs_review`, forklar tvilen og foreslå et avklaringsspørsmål.

## Arbeidsflyt

### 1. Segmenter uten å miste kontekst

Del kilden i roller, ansvar, prestasjoner, metoder, kontekst, resultater og måltall. Behold setningen rundt hvert segment slik at subjekt og eierskap ikke forsvinner.

### 2. Normaliser norsk betydning

Les `references/semantic-rules.md` når teksten inneholder sammensatte ord, nominaliseringer eller variasjoner i uttrykksmåte.

Eksempel:

- `skapte ledelseskultur`
- `skapte en kultur rundt ledelse`
- `bygget kultur for tydelig ledelse`

Disse kan få samme konsept `build:leadership-culture`, men bare dersom kilden uttrykker samme handling og omfang.

### 3. Lag atomkandidater

Returner kandidatene med kontrakten i `scripts/types.ts`:

- original tekst og kildeposisjon
- forsiktig normalisert parafrase
- semantiske konsepter og nøkkel
- foreslått atomtype
- eksplisitte fakta
- mulige implikasjoner som ikke må lagres som fakta
- konfidens og review-status

### 4. Sammenlign kandidater

Bruk `compareSemanticExpressions()` for lettvektskontroll. Et sikkert automatisk merge krever i tillegg samme rolle/kontekst og kompatible tall, datoer og eierskap. Semantisk likhet alene er bare et merge-forslag.

### 5. Send videre til review

Skillen skal produsere `NormalizationProposal[]`. Backend lagrer dem i eksisterende proposal/review-modell. Først etter eksplisitt godkjenning kan `cv-evidence-graph` opprette eller endre en varig atom.

## Claude-bruk

Bruk `NORMALIZATION_SYSTEM_PROMPT_NO` fra `scripts/prompt.ts` og krev JSON som matcher `NormalizationBatch`. Avvis eller reparer respons som mangler kildebelegg, introduserer nye fakta, bruker `ready_for_atom` ved uklarhet eller slår sammen uttrykk med motstridende omfang.

## Lovable/Claude-backend

Les `references/backend-integration.md` før implementering i Edge Functions. Skillen er kanonisk for prompt, DTO og valideringsrekkefølge. Claude-kall skjer server-side. Frontend mottar forslag og begrunnelser, aldri modellnøkler eller fri modelltekst.

## Ansvarsgrense

- `cv-atom-language-no`: forstår norsk betydning og foreslår normalisering.
- `cv-evidence-graph`: validerer struktur, hierarki, provenance og deduplisering.
- `cv-ats-rules-no`: kontrollerer ATS-format og dokumentrelevans.
- `cv-quality-no`: forbedrer formulering uten å endre fakta.
- `cv-hallucination-guard`: verifiserer sluttpåstander mot godkjente atoms.

*Skill-versjon 1.0.0 - 16. august 2026*
