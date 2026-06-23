# Arbeidsgiveranalyse: modellbenchmark

Prisgrunnlag og modelltilgjengelighet verifisert 2026-06-23 mot offisiell
dokumentasjon fra Anthropic og xAI.

## Produksjonskandidater

| Rolle | Modell | Tokenpris USD per 1M inn/ut | Nettsøk |
|---|---|---:|---:|
| Innsamling, standard | `claude-haiku-4-5` | 1 / 5 | 0,01 USD per søk |
| Innsamling, kontroll | `claude-sonnet-4-6` | 3 / 15 | 0,01 USD per søk |
| Innsamling, kandidat | `grok-4.3` | 1,25 / 2,50 | må måles fra xAI-bruk |
| Analyse, fast baseline | `claude-sonnet-4-6` | 3 / 15 | ingen nettsøk |

Kilder:

- Anthropic-modeller og priser:
  https://platform.claude.com/docs/en/about-claude/pricing
- Anthropic search-result/model support:
  https://platform.claude.com/docs/en/build-with-claude/search-results
- xAI Grok 4.3 og priser:
  https://docs.x.ai/developers/models
- xAI Responses API web search:
  https://docs.x.ai/developers/tools/web-search

## Hvorfor Sonnet ikke skal samle som standard

Sonnet er tre ganger dyrere på input og output enn Haiku før nettsøk. Når
innsamleren leverer et validert research pack og Sonnet analyserer nøyaktig det
samme formatet, kan innsamlerne sammenlignes uten å endre analysemodellen.

## Testdesign

Velg minst seks selskaper:

1. Norsk selskap med tre års Brønnøysund-regnskap.
2. Norsk selskap uten lokalt regnskap, men med årsrapport.
3. Børsnotert konsern hvor juridisk enhet og konsern må skilles.
4. Offentlig arbeidsgiver.
5. Mindre privat arbeidsgiver med begrenset kildegrunnlag.
6. Utenlandsk arbeidsgiver uten norsk organisasjonsnummer.

For hvert selskap kjøres Haiku, Sonnet og Grok med samme
`benchmark_group_id`. Sonnet 4.6 analyserer alle tre research packs. Benchmark
skriver aldri til `companies` eller bruker-/kandidatdata.
Kjør kandidatene sekvensielt og vent på `success`/`failed` før neste modell,
slik at rate limits og samtidig belastning ikke skjevfordeler varigheten.

Admin kaller eksisterende `analyze-company` med en gyldig egen session:

```json
{
  "company_id": "<eksisterende company uuid>",
  "benchmark": true,
  "benchmark_group_id": "<samme uuid for kandidatene>",
  "research_provider": "anthropic",
  "research_model": "claude-haiku-4-5"
}
```

Tillatte alternativer er `anthropic` + `claude-sonnet-4-6` og `xai` +
`grok-4.3`. Grok krever `XAI_API_KEY` som Edge-secret. Responsen er `202` med
`model_run_id`; resultatet leses fra den admin-gated benchmarkrapporten.

## Målinger

Automatisk:

- antall unike kilder
- antall scorede arbeidsgiverdimensjoner og AI-områder
- finansiell fallback funnet/ikke funnet
- input/output-token, nettsøk og varighet per fase
- estimert kostnad; xAI markeres ufullstendig dersom verktøykostnad mangler

Adminreview, 1-5:

- faktanøyaktighet
- kildekvalitet
- riktig juridisk scope
- finansiell kvalitet
- analysekvalitet

## Beslutningsregel

Bytt ikke produksjonsinnsamler basert på pris alene. Kandidaten må:

- ha gjennomsnittlig kvalitetsreview minst 4,0
- ikke være mer enn 0,25 poeng svakere enn beste kandidat
- ikke ha lavere faktanøyaktighet eller scope-presisjon enn 4,0
- levere minst tilsvarende dimensjonsdekning på fem av seks selskaper
- gi en dokumentert kostnads- eller tidsgevinst

Først etter denne testen endres `EMPLOYER_RESEARCH_PROVIDER` og
`EMPLOYER_RESEARCH_MODEL` i produksjon.
