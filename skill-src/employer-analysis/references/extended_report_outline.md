# Extended report outline

The extended tier produces a 20 to 25 page report. It includes everything in the standard tier plus the seven sections defined below. Each extended section adds an entry to the report data dictionary that the renderer consumes.

## Total page budget

- Cover: 1 page
- Executive summary: 1 page
- Methodology: 1 page
- Detailed dimension review (8 cards, two per page): 4 pages
- Peer benchmark: 1 to 2 pages
- News timeline: 1 to 2 pages
- Leadership profiles: 2 to 3 pages
- Compensation signals: 1 to 2 pages
- Sentiment trend: 1 to 2 pages
- ESG and regulatory posture: 1 to 2 pages
- AI Maturity Posture: 1 to 2 pages
- Scenario notes for the prospective employee: 1 page
- Synthesis and disclaimer: 1 page
- Source list and search log: 3 to 5 pages

Target: 22 to 27 pages total.

## Data schema additions

The renderer consumes these optional keys when tier is `extended`.

### peer_benchmark

```json
{
  "peer_benchmark": {
    "narrative": "Two-paragraph comparative narrative...",
    "peers": [
      {"name": "Peer A", "country": "NO", "score_overall": 4.1, "note": "Similar industry, larger headcount"},
      {"name": "Peer B", "country": "NO", "score_overall": 3.5, "note": "Direct competitor"}
    ]
  }
}
```

Select two to three named competitors in the same country and broadly comparable in size or segment. Include their overall score derived from the same scoring rubric, or mark `null` if not assessed.

### news_timeline

```json
{
  "news_timeline": [
    {"date": "2025-11-12", "headline": "...", "source_id": 14},
    {"date": "2025-09-03", "headline": "...", "source_id": 22}
  ]
}
```

Twelve-month timeline of material events relevant to employment: leadership changes, layoffs, restructurings, major hires, regulatory actions, M&A. Up to fifteen entries. Every entry must cite a source from the source list.

### leadership_profiles

```json
{
  "leadership_profiles": [
    {"name": "Jane Doe", "role": "CEO", "tenure": "Since 2021", "notes": "Background, prior roles, public stance"},
    {"name": "John Smith", "role": "Local Country Manager", "tenure": "Since 2023", "notes": "..."}
  ]
}
```

Three to five profiles. Always include the CEO of the local branch and the parent CEO when relevant. Notes are limited to verifiable public information.

### compensation_signals

```json
{
  "compensation_signals": {
    "narrative": "Pay benchmarks against national wage statistics...",
    "data_points": [
      "Median salary band for software engineer (levels.fyi): EUR X-Y",
      "Kununu salary range: EUR X-Y for similar role",
      "National wage statistics benchmark: above/below median"
    ]
  }
}
```

Pull from levels.fyi, Glassdoor salary, Kununu salary, and the national wage statistics agency. Always present as ranges, never as a single point.

### sentiment_trend

```json
{
  "sentiment_trend": {
    "narrative": "Sentiment trajectory across review platforms...",
    "data_points": [
      "Glassdoor 12-month rating delta: +0.2",
      "Indeed share of negative reviews increased from X% to Y%",
      "Kununu (DACH) consistently above industry average"
    ]
  }
}
```

Compare current sentiment against the prior 24 months where data is available. Identify direction, magnitude, and the most common topic in negative reviews.

### esg_section

```json
{
  "esg_section": {
    "narrative": "ESG and regulatory posture summary...",
    "highlights": [
      "CSRD reporting compliant since 2024",
      "Åpenhetsloven report published 2024-06",
      "UK Gender Pay Gap median 8.3%",
      "No active sanctions or major regulatory actions identified"
    ]
  }
}
```

Cover country-specific regulatory reporting requirements (Åpenhetsloven, CSRD, UK Gender Pay Gap), ESG ratings if available (Sustainalytics, MSCI, ISS), and any material regulatory actions.

### ai_maturity_posture

```json
{
  "ai_maturity_posture": {
    "applicable": true,
    "applicability_note": null,
    "score": 4.0,
    "narrative": "Overall AI maturity assessment, two paragraphs.",
    "signals": {
      "strategy_and_leadership": "Findings on named AI leadership, board-level statements, strategy documents.",
      "capability_and_deployment": "Findings on AI products, hyperscaler partnerships, patents, code releases.",
      "workforce": "Findings on AI hiring, AI titles count on LinkedIn, internal upskilling programs.",
      "governance": "Findings on AI ethics policy, ISO 42001, EU AI Act readiness, NIST AI RMF.",
      "market_and_product": "Findings on AI in customer products, analyst recognition, case studies."
    },
    "key_evidence": [
      "Specific evidence bullet 1",
      "Specific evidence bullet 2",
      "Specific evidence bullet 3"
    ],
    "source_ids": [12, 18, 25]
  }
}
```

Scoring rubric (1.0 to 5.0):

- 1.0: No public AI strategy, AI not mentioned in annual report, no AI roles posted, no AI products.
- 2.0: Generic AI mentions in marketing material. No concrete deployment. No dedicated AI roles.
- 3.0: Active pilots, some AI roles posted, internal AI tooling in use, AI in product roadmap but not yet shipped at scale.
- 4.0: Active deployment, named AI leadership, multiple AI products, hyperscaler partnership, AI in core business strategy.
- 5.0: Industry leader. Named AI platform or product line. External recognition (analyst rankings, awards). ISO 42001 or comparable governance. AI embedded across operations.

Applicability rule: when the company operates in a sector where AI is currently of low strategic relevance (small construction firms, local retail, hospitality SMBs, traditional crafts), set `applicable: false` and `applicability_note` to a one-line reason. In that case, score and signals can be null or omitted, and the report shows the note instead of a score.

Industry-relevance thresholds (low threshold): if any one of these is true, AI Maturity is assessed and scored: the company has more than 100 employees; the company operates in technology, finance, consulting, professional services, manufacturing, energy, healthcare, education, public sector, telecoms, media; the company has investor-facing communications; the company has a public sustainability or innovation strategy.

Search budget: 8 to 10 searches in addition to the 75 total. Distribute as 2-3 strategy/leadership, 2-3 capability, 2 workforce (LinkedIn), 1-2 governance, 1-2 market/product.

### scenario_notes

```json
{
  "scenario_notes": [
    "If you are an early-career engineer, prioritize verifying the published mentoring program against employee reports.",
    "If you are a senior leader, the recent restructuring may affect reporting lines for the next 6 to 12 months.",
    "If you are relocating internationally, confirm the relocation support package directly in the offer stage."
  ]
}
```

Three to five short, action-oriented notes addressing specific candidate profiles. Practical guidance, not generic advice.

## Search budget

The extended report has a 85-search hard limit (vs. 30 for standard). Distribute roughly:

- 30 searches for the eight base dimensions
- 10 searches for the peer benchmark
- 10 searches for the news timeline and leadership profiles
- 10 searches for compensation signals
- 10 searches for sentiment trend, ESG, and regulatory posture
- 10 searches for AI Maturity Posture (skip if applicable=false)
- 5 searches reserved for follow-up on weak findings

## Quality requirements specific to extended

- Every extended section cites at least two independent sources.
- The peer benchmark uses the same scoring rubric for the named peers, even if abbreviated.
- The news timeline only includes events that are independently reported, not company press releases.
- Compensation signals are presented as ranges with named source platforms.
- AI Maturity Posture requires findings from at least three of the five signal categories before a score is assigned. Otherwise set applicable=false.
- Scenario notes are actionable and tied to specific candidate situations, not generic advice.
