# Report Methodology Text

> **Source of truth:** the user-facing methodology text on the rendered Methodology page is owned by `scripts/i18n.py` (keys `score_1_desc` through `score_5_desc`, `insufficient_evidence_explainer`, `sourced_explainer`, `inferred_explainer`, `citation_traceability_note`). The English text below is for reference only and reflects the canonical English wording. To change wording in any language, edit `i18n.py` and re-run `tests/test_language_consistency.py`.

This file contains the exact text inserted into the Methodology and Definitions page (page 3) of every report. The renderer pulls these blocks into the HTML template.

---

## Geographic scope statement template

`This report focuses on {branch_entity} ({branch_country}) as the local employer, with secondary reference to {parent_entity} ({parent_country}) where relevant. Findings on culture, leadership, work environment, career development, and talent practices reflect the local branch wherever distinct evidence is available. Findings on financial stability and mission may draw on the parent entity, with each such case marked in the rationale.`

When the local branch is the same as the legal headquarters, use this shorter version:

`This report covers {entity} ({country}) as a single employer entity with no separate parent.`

When the country is outside the in-scope list, append this note:

`This company falls outside the skill's primary geographic scope. Findings should be read with awareness that source coverage may be less complete than for the listed countries.`

---

## Score scale (verbatim, every report)

**Scoring scale:** All dimensions are scored from 1.0 to 5.0 in 0.5 increments. 3.0 is a neutral baseline derived from mixed or average evidence, not a default placeholder.

- **1.0** Significant concern with concrete evidence
- **2.0** Below average, multiple weak signals
- **3.0** Neutral baseline or mixed evidence
- **4.0** Above average, multiple supporting signals
- **5.0** Strong and well-evidenced across independent sources

---

## Insufficient evidence definition (verbatim, every report)

**Insufficient evidence:** A dimension is flagged as `Insufficient Evidence` when fewer than two independent sources are found for that dimension, or when the available sources are too generic to support a substantive assessment. Flagged dimensions are excluded from the overall score calculation, and the overall is stated as based on N of 8 dimensions.

---

## Sourced versus inferred definition (verbatim, every report)

**Sourced versus Inferred:** Each dimension is labeled either Sourced or Inferred.

- **Sourced** — finding is directly supported by one or more independent external sources listed in the source list.
- **Inferred** — finding is derived from logical reasoning over indirect signals when no direct source is available. The reasoning chain is described briefly in the rationale.

---

## Citation conventions (verbatim, every report)

**Citations:** Every claim in this report is traceable to a numbered source in the source list (page 10+). Direct quotes are kept under fifteen words. Longer source material is paraphrased. The full search log appended after the source list shows every web search performed for this report.

---

## Disclaimer (verbatim, page 9)

This report is based on publicly available information and web-sourced research at the time of analysis. Scores reflect an evidence-based assessment but are not a substitute for direct due diligence, interviews with current and former employees, or professional career advice. KarrierenMin.no makes no warranties regarding the accuracy, completeness, or current validity of the information presented. Use this report as one of several inputs in your employment decision.
