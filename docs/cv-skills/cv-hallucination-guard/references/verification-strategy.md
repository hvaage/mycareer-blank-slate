# Verifikasjons-strategi

Hvordan vi går fra AI-output til en verifisert vurdering av om hver claim er
støttet i evidens-grafen.

## To-passes-arkitektur

### Pass 1: Rule-based ekstraksjon og eksakt match

Lokal, rask, deterministisk. Fanger:

- Tall (beløp, prosent, antall)
- Datoer og varigheter
- Navngitte entiteter (selskap, institusjon, sertifikat)
- Posisjons-titler

For hver hard claim, kjør eksakt-matcher mot relevante atoms. Resultat:
`verified` eller `unverified`/`contradicted`.

Pass 1 fanger ca. 70 % av hallusinasjons-tilfeller — typisk tall-feil og
datoavvik. Den er nok for fast-mode-validering i UI under skriving.

### Pass 2: LLM-judge for soft claims

Sender claim-tekst og topp 3–5 kandidat-atoms til Claude API. Claude svarer:

```json
{
  "verdict": "verified" | "partial" | "unverified" | "contradicted",
  "confidence": 0.0-1.0,
  "reasoning": "kort forklaring på norsk",
  "supporting_atom_ids": ["atom-id-1", "atom-id-2"]
}
```

Pass 2 brukes:
- Før eksport av master-CV
- Før jobbtilpasset CV sendes til ATS
- Når Pass 1 finner partial-match som krever menneskelig vurdering

## Modi

| Modus | Pass 1 | Pass 2 | Når |
|---|---|---|---|
| `fast` | ✓ | – | Sanntid i UI under redigering |
| `standard` | ✓ | for partial-treff | Etter generering, før visning |
| `strict` | ✓ | for alle soft claims | Før eksport eller sending |

## LLM-judge prompt-struktur

Promptet til Claude er fast og kontrollert. Hovedkomponenter:

1. **System-prompt:** "Du er en streng faktasjekker for CV-tekst. Du verifiserer kun mot oppgitte atoms. Du gjetter aldri."
2. **Atoms-blokk:** JSON-liste med relevante atoms (de Pass 1 har valgt som kandidater)
3. **Claim-blokk:** Den spesifikke setningen eller bulletten som skal vurderes
4. **Output-format:** Krever JSON-output med felter over

Kandidat-utvelgelse for Pass 2: Pass 1 trekker ut entiteter og tall fra claim,
finner atoms som inneholder samme entitet eller relatert tall, og sender de
3–5 mest relevante til LLM-judge.

## Konflikthåndtering

Når Pass 1 og Pass 2 er uenige:

- Pass 1 sier `verified`, Pass 2 sier `unverified` → Pass 2 vinner. Pass 1 har sannsynligvis matchet på overflate-mønster.
- Pass 1 sier `contradicted`, Pass 2 sier `verified` → Pass 1 vinner. Eksakt-tall-mismatch er objektivt.
- Pass 1 sier `partial`, Pass 2 sier `verified` → Pass 2 vinner med dokumentert resonnering.

## Performance-budsjett

- Pass 1: < 50 ms for hele en CV (~30 claims). Kjøres synkront i Edge-funksjon.
- Pass 2: ~1–3 sek per claim med Claude Haiku. Kjøres parallelt for alle soft claims.

For full-mode validering av en hel CV: ~5–10 sek totalt.

## Hva vi gjør med resultater

### Strict-mode + unverified eller contradicted

Edge-funksjonen returnerer feilmelding til frontend. Brukeren ser:

> "Følgende påstander kan ikke verifiseres mot din evidens-graf:
> - 'ledet team på 50 personer' — atom sier 27 ansatte
> - 'rapporterte til CEO' — ingen rapporterings-atom funnet"

Brukeren kan velge:
- Regenerere bullet uten påstanden
- Legge til atom som støtter påstanden
- Aksepterer påstanden manuelt (logges som user-confirmed override)

### Standard-mode + partial

Bullet vises men markeres med ikon i UI. Bruker hover viser hvilken claim som
er partial og hvorfor.

### Fast-mode + unverified hard claim

Inline-feedback i editor: rødt understrek under tallet, tooltip viser
hva atom faktisk sier.
