---
name: employer-analysis
description: Produce an evidence-based PDF report on a European employer for prospective employees. Use this skill whenever the user asks to analyze, research, evaluate, or produce a report on a specific company as an employer in Norway, Sweden, Denmark, Finland, Iceland, Germany, the Netherlands, Belgium, Luxembourg, France, the United Kingdom, Spain, Portugal, Italy, Austria, or Switzerland. Trigger phrases include analyze this employer, employer report, is X a good place to work, employer due diligence, research this company for a job, or any request that names a specific European company and asks for an assessment of working conditions, culture, leadership, financial stability, or related dimensions. Also trigger when the user simply invokes the skill name without arguments. The output is always a downloadable PDF in the language the user selects.
license: Proprietary - KarrierenMin.no
version: 1.3.1
---

# Employer Analysis

Produce an evidence-based PDF report assessing a European employer along eight dimensions, written for prospective employees and based on public sources. The skill supports two report tiers and twelve report languages.

> **v1.2 note:** adds AI Maturity Posture as an extended-tier section, expands the Norway source list (Miljøfyrtårn, jobbi.no, Datatilsynet, DiBK, StartBANK, Magnet JQS, lærebedrift-status) and adds cross-country ISO certification and GDPR enforcement source registries. Switches base typography to IBM Plex Sans and fixes the cover wordmark truncation. See `CHANGELOG.md`.

## When this skill triggers

The skill triggers in three situations:

1. The user asks for an analysis, evaluation, due diligence, or report on a specific company as an employer in one of the in-scope countries.
2. The user names a specific company and asks any question about it as an employer.
3. The user invokes the skill name only, with no arguments.

The skill does not trigger on general questions about the labor market, salary benchmarks, or interview preparation.

Output is always a PDF file delivered via `/mnt/user-data/outputs/`. Never produce the report as an inline summary in chat.

## Geographic scope

In scope: Norway, Sweden, Denmark, Finland, Iceland, Germany, Austria, Switzerland, Netherlands, Belgium, Luxembourg, France, United Kingdom, Spain, Portugal, Italy.

The skill prioritizes the local branch office in the country supplied by the user. The legal headquarters in another country is referenced secondarily as context for financial stability, governance, and overarching corporate culture.

If the user requests analysis of a company outside the scope, proceed but mark the scope deviation explicitly in the methodology section of the report.

## Required input from user

Before starting, confirm that all five inputs below are present. If anything is missing or ambiguous, run the interactive intake (see next section) before any research begins.

1. **Company name** — full legal or commonly used commercial name (for example `Siemens AG`).
2. **Domain** — the company's primary web address (for example `siemens.com`). Strip any protocol or path.
3. **Country** — ISO Alpha-2 code for the country where the role is located (for example `DE`).
4. **Report language** — ISO 639-1 code for the language the final PDF is written in. Supported languages are listed in `references/language_codes.md` and enforced by `scripts/i18n.py`.
5. **Report tier** — either `standard` (8 to 10 pages) or `extended` (20 to 25 pages).

Do not infer any of these from the company name alone. Ask the user.

## Interactive intake

If the user invokes the skill without enough arguments, run the intake in the following exact order. Ask one block at a time. Wait for the user to answer before asking the next block.

### Block 1: Company

Ask the user to provide both the company name and the primary web address. Do not proceed until both are supplied.

### Block 2: Country and language

Ask the user to confirm the country where the role is located. Use the ISO Alpha-2 list from `scripts/source_registry.py`.

Ask the user to select the report language from the twelve supported options below. Always present the full list. Do not pre-select based on browser, machine locale, or country, because the AI runtime cannot reliably detect any of these. The user selects explicitly.

Supported report languages: Norwegian Bokmål (`nb`), Swedish (`sv`), Danish (`da`), Finnish (`fi`), Icelandic (`is`), German (`de`), Dutch (`nl`), French (`fr`), English (`en`), Spanish (`es`), Portuguese (`pt`), Italian (`it`).

### Block 3: Report tier

Ask the user to choose between two report tiers:

- **Standard** — 8 to 10 pages. Cover, executive summary with radar chart, methodology, eight dimension cards, synthesis, source list, search log. Estimated runtime around three to five minutes.
- **Extended** — 20 to 25 pages. Everything in Standard, plus deeper per-dimension treatment, peer benchmarking, recent news timeline, leadership profiles, compensation signals, sentiment analysis from employee reviews, ESG and regulatory section, scenario notes for the prospective employee, expanded source list. Estimated runtime around ten to fifteen minutes.

If the user selects `extended`, perform the pre-flight model check defined in the next section before starting research.

## Pre-flight model check (extended report only)

The extended report requires the highest available model tier on the running platform. Before any research begins, ask the model to identify itself:

1. State to the user, in the chosen report language: "The extended report is calibrated for the highest model tier on this platform. I will verify the active model before continuing."
2. Identify the active model from the runtime context. On Claude this should be Opus 4.7 or newer. On any other platform the equivalent flagship model is required.
3. If the active model is not the flagship, issue this warning to the user, then continue: "The active model is not the highest tier available on this platform. The extended report can still be produced, but the deeper sections that depend on long-context synthesis and nuanced cross-source reasoning may be less reliable than on the flagship model. To get the full quality benefit, switch to the flagship model and re-run the skill."
4. Log the model identity and the warning state into the report's methodology section so the reader can see which model produced the report.

Do not block on a warning. The skill always continues after warning.

## Workflow

### Step 1: Identify entities

Use the supplied domain and country code to identify the local branch office entity. Identify the parent or legal headquarters entity if different. Record both for the report's introduction.

To look up registry information for the target country, consult `references/data_sources_per_country.md` and `scripts/source_registry.py`.

### Step 2: Run structured web research

Run targeted web searches across the defined source categories.

Search budget:

- Standard report: hard limit of 30 searches.
- Extended report: hard limit of 75 searches.

For each of the eight dimensions, search across at least three different source types before assigning a score. Categories per dimension are defined in `references/scoring_rubric.md`.

Always include searches against:

- Glassdoor, Trustpilot, LinkedIn, Indeed, Kununu (DACH)
- Great Place to Work ratings, certifications, and Best Workplaces lists
- The local country register identified in `scripts/source_registry.py`
- The company's sustainability report and investor relations page
- Country-specific regulatory reporting (Åpenhetsloven, CSRD, UK Gender Pay Gap, etc.)

For the extended tier, additionally cover:

- The expanded source matrix in `references/extended_report_outline.md`
- Direct peer comparison against two to three named competitors in the same country
- Twelve-month news timeline with material events
- Compensation signals from levels.fyi, Kununu salary, Glassdoor salary, and national wage statistics
- Sentiment trend across employee review platforms over the last 24 months where data is available

### Step 3: Score each dimension

Score these eight dimensions on a 1.0 to 5.0 scale in 0.5 increments. 3.0 is a neutral baseline, not a default score.

1. Culture and Values
2. Leadership Quality
3. Work Environment
4. Career Development
5. Financial Stability
6. Mission and Purpose
7. Talent Attraction and Retention
8. Diversity and Inclusion

Definitions of each score level and detailed criteria per dimension live in `references/scoring_rubric.md`. Read this file before scoring.

**Insufficient evidence rule:** if fewer than two independent sources are found for a dimension, or if available sources are too generic, flag the dimension as `insufficient_evidence` instead of assigning a score. Flagged dimensions are excluded from the overall score and the report states it is based on N of 8 dimensions.

**Sourced versus inferred:** every finding is labeled either `sourced` or `inferred`. When inferring, describe the reasoning chain in the rationale.

### Step 4: Assemble the report data structure

Build a Python dictionary matching the schema documented in `scripts/render_report.py`.

For the standard tier, populate the base schema (company metadata, overall score, eight dimensions, executive bullets, synthesis paragraphs, sources, search log).

For the extended tier, additionally populate the extended fields documented in `references/extended_report_outline.md` (peer_benchmark, news_timeline, leadership_profiles, compensation_signals, sentiment_trend, esg_section, scenario_notes).

### Step 5: Render the PDF

Run the renderer to produce the PDF:

```bash
python /home/claude/employer-analysis/scripts/render_report.py \
  --data /path/to/report_data.json \
  --language <iso639-1> \
  --tier <standard|extended> \
  --output /mnt/user-data/outputs/employer-analysis-<company>-<language>-<YYYYMMDD>.pdf
```

The renderer selects template (`assets/template_standard.html` or `assets/template_extended.html`), applies the language pack from `scripts/i18n.py`, and embeds the radar chart from `scripts/generate_radar.py`.

### Step 6: Deliver to user

Save the PDF to `/mnt/user-data/outputs/` and present it. Keep the chat response short: a one-paragraph summary of the overall score plus a brief note on what to check first in the PDF, written in the same language as the report. The PDF is the deliverable.

### Step 7: Ask for consent and submit to the Analysedatabase (MANDATORY)

This step is not optional. After the PDF is delivered, you MUST do both of the following in order:

1. Show the consent block (see "Data submission and user consent" below) verbatim in the selected report language and wait for the user's explicit Yes / No answer.
2. Immediately after the user answers — regardless of whether they say Yes or No — execute the submission script. The script itself respects the consent flag and will not send anything if `consent=False`.

Run this Python snippet with the same `report_data` dict you built in Step 4, the user's answer as `consent`, and the same `tier` and `language` you used for rendering:

```python
import sys
sys.path.insert(0, "/home/claude/employer-analysis/scripts")
from submit_report import submit_anonymous

result = submit_anonymous(
    report_data=report_data,   # the dict assembled in Step 4
    consent=user_said_yes,     # True if the user answered Yes, False otherwise
    tier=tier,                 # "standard" or "extended"
    language=language,         # the ISO 639-1 code used for the PDF
)
print(result)  # e.g. {"sent": True, "reason": "ok", "status_code": 200}
```

Then tell the user, in the report language, one short sentence about what happened:

- `result["sent"] == True` → "Sammendraget er sendt til Analysedatabasen på karrierenmin.no."
- `result["sent"] == False` and `result["reason"] == "user_opted_out"` → "Sammendraget ble ikke sendt — rapporten forblir lokal."
- Any other `False` → "Innsending feilet (<reason>). Rapporten din er upåvirket."

Record the consent answer and the `result` dict in the report's methodology page so the reader can see whether the report was contributed.

## Quality requirements

- Minimum two independent sources per scored dimension. Independent means the source is not published or controlled by the company itself.
- Maximum fifteen words per direct quote. Longer passages are paraphrased.
- Every claim in the report must trace back to a numbered source in the source list.
- Every report includes the score scale, insufficient evidence, and sourced versus inferred definitions on the methodology page.
- Every search is logged in the search log appendix so the report is reproducible.
- For extended reports, every additional section (peer, news, leadership, compensation, sentiment, ESG) must cite at least two independent sources.

## Reference files

- `references/scoring_rubric.md` — detailed scoring criteria per dimension, signal types, red flags
- `references/data_sources_per_country.md` — country-by-country source overview
- `references/report_methodology.md` — methodology text inserted into every report (master English version, translated at render time)
- `references/extended_report_outline.md` — schema and content guidance for the extended tier
- `references/language_codes.md` — supported language codes, native names, and translation status

## Scripts

- `scripts/render_report.py` — renders the final PDF via weasyprint, selects template by tier, applies i18n
- `scripts/generate_radar.py` — generates the radar chart as inline SVG
- `scripts/source_registry.py` — maps country code to relevant registers and primary URLs
- `scripts/i18n.py` — language packs (UI labels, methodology text, disclaimer) for the twelve supported languages

## Assets

- `assets/template_standard.html` — HTML template for the 8 to 10 page report
- `assets/template_extended.html` — HTML template for the 20 to 25 page report
- `assets/styles.css` — print stylesheet with page break controls
- `assets/logo.png` — placeholder for KarrierenMin.no logo

## Tests

- `tests/test_language_consistency.py` — regression guard against English text leaking into non-English renders. Renders a minimal payload for every supported language at both tiers and verifies no canonical English methodology phrase appears in non-English output. Also verifies no `{{LBL_*}}` token is left unresolved. Run with:

```bash
python tests/test_language_consistency.py
```

Run this test after any change to `i18n.py`, the HTML templates, or `render_report.py`. Exit code 0 means clean, exit code 1 means at least one regression.

## Edge cases

**Scope deviation:** if the country code is outside the in-scope list, proceed but add a prominent scope deviation note to the methodology page.

**Multiple branch entities in the same country:** if the company has several legal entities in the country (for example a holding plus an operating company), select the entity most likely to be the actual employer and note the choice in the introduction.

**Very small companies:** when public financial sources do not provide sufficient data for the Financial Stability dimension, flag it as insufficient_evidence rather than guessing.

**Parent context only:** if the local branch has minimal independent presence and most evidence concerns the parent, state this in the report introduction and adjust the framing accordingly.

**Language not in the twelve supported list:** decline politely and offer the closest supported language. Do not generate a partial-language report.

## Disclaimer

The report carries the disclaimer text from `scripts/i18n.py` in the selected language. Do not modify it.

## Data submission and user consent

When the report PDF has been generated, the skill submits an anonymous,
structured summary of the report to **karrierenmin.no's Analysedatabase**
("Analysis database"). The submission builds an open, shared knowledge base
that every user of the skill benefits from.

Before the very first submission in a session — and any time the user asks
"what is being sent?" — present the following consent block verbatim in the
selected report language, then ask the user explicitly. Do not submit until
the user answers.

> **What is sent to karrierenmin.no?**
> When this report is finished, the skill sends an anonymous summary to the
> **Analysedatabase** at karrierenmin.no. This builds an open, growing
> knowledge base that every user benefits from.
>
> **Sent:**
> - Company name, domain, country, industry (NACE)
> - Analysis date, report language, tier (standard / extended)
> - Overall score and score per dimension (1.0–5.0, or "insufficient data")
> - Employee count and revenue bucket, when available from public registers
> - Number of sources and searches used
>
> **Not sent:**
> - Your name, email, IP, or any user identifier
> - The PDF itself
> - What you searched for or which sources the skill picked
>
> **How is it used?**
> Aggregated results appear publicly in the **Analysedatabase** at
> karrierenmin.no/selskapsanalyse/analysedatabase so other job seekers can
> see how the employer is assessed and how the assessment evolves over
> time. Nothing is linked back to you.
>
> **Send report to the Analysedatabase?**
>   [ Yes, contribute to the shared database ]
>   [ No, keep this report local only ]

Pass the user's answer to ``scripts/submit_report.submit_anonymous`` as the
``consent`` boolean. When the user opts out, the function returns
``{"sent": False, "reason": "user_opted_out"}`` and nothing leaves the
skill runtime.

Record the consent state in the report's methodology page so the reader can
see whether the report was contributed to the Analysedatabase.
