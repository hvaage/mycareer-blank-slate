# Vanlige hallusinasjons-mønstre

Empiriske observasjoner av hvordan AI feiler når den genererer CV-tekst.
Brukes som test-tilfeller for guarden og som dokumentasjon for prompt-engineering
i Edge-funksjonene.

## 1. Tall-eskalasjon

AI gjør tall større enn de er for å låte mer imponerende.

| Atom | Hallusinert output |
|---|---|
| `27 ansatte` | "team på 30+ ansatte" (akseptabel avrunding) |
| `27 ansatte` | "team på 50 ansatte" (tall-eskalasjon) |
| `USD 45 mill. omsetning` | "tilnærmet 50 mill." (akseptabel) |
| `USD 45 mill. omsetning` | "USD 100 mill." (eskalasjon) |
| `40 % vekst` | "doblet seg" (kvalitativ eskalasjon) |

**Mitigering:** Hard-claim eksakt-match med ±20 %-toleranse. Større sprang flagges.

## 2. Tittel-promotering

AI promoterer kandidatens rolle-bidrag.

| Atom | Hallusinert output |
|---|---|
| `is_team_achievement: true, scope: "salgsteam"` | "Vant kontrakten alene" |
| `bidro til lansering` | "Ledet lanseringen" |
| `medlem av prosjektgruppe` | "Drev prosjektet" |

**Mitigering:** LLM-judge må sjekke om atom har `is_team_achievement: true` eller bruker svake verb som "bidro", og ikke akseptere sterkere verb i output.

## 3. Strukturell fabrikasjon

AI legger til struktur som ikke finnes.

| Eksempel hallusinasjon | Problem |
|---|---|
| "rapporterte til CEO" | Atom har ikke reporting-line-info |
| "satt i ledergruppen" | Ingen atom om organisatorisk plassering |
| "ansvarlig for et budsjett på NOK 100 mill." | Atom har ikke budget-info |

**Mitigering:** Ekstrakter for posisjon/reporting/budget-claims, sjekk mot `context`-atoms eller `role.structured_data`-felter.

## 4. Selskaps-sammenblanding

AI sammenblander to ulike rolle-atoms.

| Atom 1 | Atom 2 | Hallusinasjon |
|---|---|---|
| Cisco 2010-2015, Country Manager | Symantec 2003-2008, etablerte Norge | "Etablerte Cisco Norge" |

**Mitigering:** Pass 2 LLM-judge får alle relevante role-atoms og må eksplisitt sjekke at claim hører til riktig rolle.

## 5. Tidslinje-dekomposisjon

AI sprer ett achievement over flere år enn det egentlig gjelder.

| Atom | Hallusinasjon |
|---|---|
| `Q3 2023: økte ARR med 40 %` | "økte ARR med 40 % YoY i to år på rad" |
| `2023: lansert ny produktlinje` | "transformerte produktportefolio i perioden 2021-2024" |

**Mitigering:** Sjekk at claim-tidsperiode er innenfor atom-tidsperiode.

## 6. Industri-stereotypisering

AI tilfører "typisk" innhold for bransjer eller stillinger som ikke står i atoms.

| Rolle-tittel | Hallusinasjon basert på stereotyp |
|---|---|
| `Salesperson` | "MEDDPICC-sertifisert" (uten atom) |
| `Engineering Manager` | "Bygget DevOps-kultur" (uten atom) |
| `COO` | "Ansvarlig for P&L" (uten atom om dette) |

**Mitigering:** Ekstrakter for fag-spesifikke termer, krev at de kommer fra atoms (skill, certification, achievement).

## 7. Oversettelses-glidning

AI endrer betydning mellom NO ↔ EN.

| Atom (NO) | EN-output |
|---|---|
| `bidro til` | "led" (for sterkt) |
| `var del av` | "spearheaded" (for sterkt) |
| `ansvar for` | "owned" (sterkt, men kan være OK i tech) |

| Atom (EN) | NO-output |
|---|---|
| `responsible for` | "drev" (for sterkt) |
| `helped` | "ledet" (kraftig over-oversettelse) |

**Mitigering:** LLM-judge med eksplisitt regel om å ikke styrke verb under oversettelse.

## 8. Kontekst-konfabulering

AI fyller ut detaljer som låter plausible men ikke er i atoms.

| Atom | Hallusinasjon |
|---|---|
| `etablerte salgsteam` | "etablerte 7-personers salgsteam fordelt på Oslo og Bergen" |
| `digital transformasjon` | "transformerte fra on-premise til cloud-først arkitektur" |

**Mitigering:** Pass 2 LLM-judge må eksplisitt rapportere om claim inneholder "fakta-detaljer som ikke er i atoms".

## 9. Recency-bias

AI favoriserer nyere termer (AI/GenAI/RAG) selv når atom er fra før disse var aktuelle.

| Atom (2018) | Hallusinasjon |
|---|---|
| `bygget data-pipeline` | "bygget AI-drevet data-pipeline" |
| `effektiviserte rapportering` | "automatiserte rapportering med ML" |

**Mitigering:** Sjekk at moderne fag-termer i claim faktisk finnes i atom (som tool eller skill).

## 10. Generisk fluffing

AI legger til intetsigende men positiv-klingende fraser.

| Eksempel |
|---|
| "..med fokus på resultater og kontinuerlig forbedring" |
| "..gjennom datadreven beslutningsproses" |
| "..i tråd med strategiske målsettinger" |

**Mitigering:** Kvalitetsmessig — disse fanges av `cv-quality-no`, ikke her. Men hvis frasen inneholder konkrete claims (f.eks. "datadreven"), må de støttes.

## Test-suite

Hver av disse mønstrene bør ha minst én test i CI for guard.ts. Test-tilfeller
ligger ikke i Skill-en (det er Edge-funksjons-prosjektets ansvar), men dette
dokumentet er oppskriften.

## Når guard ikke fanger noe

Hvis en hallusinasjon kommer gjennom guard og oppdages i produksjon (brukeren
sier "dette stemmer ikke"), skal dokumentet oppdateres med:

- Konkret eksempel
- Hvorfor guard ikke fanget det
- Forslag til regel-endring (i extractor, matcher eller LLM-judge-prompt)

Dette er en levende dokument.
