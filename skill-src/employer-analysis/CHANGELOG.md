
## [1.3.2] — 2026-05-21

### Fixed
- **Cover-page improvisation.** Earlier renders sometimes shipped with the
  KarrierenMin logo missing, the company H1 overlapping the entity line,
  and a score / "Report level" / "Searches run" badge stacked on the cover.
  Root cause: Claude was treating Step 5 as advisory and writing a custom
  cover instead of using the bundled WeasyPrint template.
- Locked `assets/template_standard.html` cover block and added a
  `<!-- DO NOT MODIFY -->` guard. Added explicit vertical rhythm between
  `.cover-company` and `.cover-entity` in `styles.css`, reserved
  `min-height` on `.cover-logo-area` so the cover never collapses if the
  SVG fails to embed, and enabled word-wrap on long company names.

### Changed
- **`SKILL.md` Step 5 → MANDATORY** with explicit "do not improvise"
  guardrails: must use bundled template + `styles.css`, must install
  WeasyPrint (no markdown→PDF fallback), no custom cover, no scores or
  meta fields on the cover, no inline `<style>` blocks. Added a six-point
  cover checklist to verify before delivery.
- `scripts/render_report.py`: new `_assert_cover_assets()` runs before
  WeasyPrint and fails loudly when `logo.svg` / `logo-footer.svg` /
  `styles.css` are missing. Missing WeasyPrint now raises a
  `RuntimeError` with install instructions instead of a generic
  `ImportError`. Logs WeasyPrint version, tier, language, and resolved
  output path to stderr.

### Internal
- Skill source files now live in the karrierenmin.no repo under
  `skill-src/employer-analysis/` (not just inside the base64 bundle).
  `scripts/build-skill.mjs` rebuilds the `.skill` zip and refreshes
  `src/server/skill-bundle.ts` from these sources.

## [1.3.1] — 2026-05-21

- SKILL.md: added explicit Step 7 with a runnable Python snippet that calls `submit_report.submit_anonymous`. Earlier versions described the submission in prose only, so Claude often delivered the PDF and never reached the submission code.
- SKILL.md frontmatter version bumped from 1.2.0 to 1.3.1.
- Renamed top-level folder to `employer-analysis-v1.3/`.
# Changelog

All notable changes to the employer-analysis skill.

## [1.3.0] — 2026-05-21

### Added
- **Schema 1.1** for the submission payload. New optional fields on
  `company`: `employee_count`, `employee_count_source`,
  `employee_count_as_of`, `revenue_bucket`, `industry_nace`. These let the
  Analysedatabase track company size, revenue bucket and industry context
  over time.
- **`report_id`** (client-generated UUID) on every submission, for
  idempotency. Retrying after a network blip no longer creates duplicate
  rows in the receiver.
- **All eight dimensions are always submitted**, even when the skill could
  not score a dimension. Unscored dimensions are sent with `score: null`
  and an explicit label of `insufficient_data` so data-quality information
  is preserved in the Analysedatabase.
- **Explicit consent block** in `SKILL.md` ("Data submission and user
  consent") that the skill presents to the user before the first
  submission of a session, naming the **Analysedatabase** at
  karrierenmin.no/selskapsanalyse/analysedatabase, listing exactly what is
  and is not sent, and offering an explicit opt-out.

### Changed
- **`config.json`** now points to the production Analysedatabase ingest
  endpoint (`https://karrierenmin.no/api/public/ingest-report`) with the
  shared `km_skill_eaa_pub_2026_*` ingestion key. No environment variables
  required. The endpoint validates, deduplicates by `report_id`, and
  rate-limits per IP per day.
- **`scripts/submit_report.py`**: bumps `SCHEMA_VERSION` to `1.1`, adds
  `uuid.uuid4()` per call, includes the new company-context fields, and
  normalizes unscored dimensions to `score: null` /
  `label: "insufficient_data"` so the full eight-dimension array is always
  present in the payload.

### Migration notes
- Schema 1.0 payloads are still accepted by the receiver. The new fields
  are optional — older skill versions will continue to submit successfully.
- No PDF rendering changes. The consent text appears at the runtime
  interaction layer, not in the PDF.


## [1.2.0] — 2026-05-21

### Added
- **`config.json`** at the root of the skill package. Contains `supabase_endpoint` and `supabase_anon_key` for the ingestion function. All users who install the skill now submit reports automatically without needing any configuration. For custom deployments, replace these values with your own Supabase instance details before packaging.
- **AI Maturity Posture** as a new extended-tier section. Scored on the same 1.0–5.0 scale as the eight base dimensions, but rendered as a standalone section rather than a ninth radar axis. Five signal categories are reported as a table: strategy and leadership, capability and deployment, workforce, governance and responsible use, market and product. Includes an applicability switch: when industry relevance is low, the section renders "Not assessed — low industry relevance" instead of a score. Industry-relevance threshold is intentionally low (employer size, sector, public communications, sustainability or innovation strategy). Schema documented in `references/extended_report_outline.md`. Search budget for extended tier increases from 75 to 85 to accommodate.
- **Eleven new i18n keys** in every language pack: `ai_maturity_title`, `ai_maturity_intro`, `ai_maturity_not_applicable`, `ai_signal_strategy`, `ai_signal_capability`, `ai_signal_workforce`, `ai_signal_governance`, `ai_signal_market`, `ai_key_evidence_label`.
- **Norway source registry expansion** (`references/data_sources_per_country.md`): Miljøfyrtårn (public certification register), jobbi.no (anonymous employee reviews, with explicit corroboration rule), Datatilsynet (GDPR enforcement, check-if-relevant with low threshold), DiBK Sentral godkjenning, StartBANK, Magnet JQS, Utdanningsdirektoratet (lærebedrift-status).
- **Cross-country ISO certification registry**: ISO 9001, 14001, 27001, 27701, 42001, 45001, plus EcoVadis. Each entry documents what the certification signals for a prospective employee, and how to verify against the certifying body.
- **Cross-country GDPR and privacy enforcement registry**: national DPAs for all sixteen in-scope countries plus EDPB and enforcementtracker.com. Low threshold for inclusion in reports: any decision in the last 36 months.
- **AI maturity source registry**: five signal-category-specific source lists.
- **IBM Plex Sans** as the base font, loaded via Google Fonts CDN with weights 300/400/500/600/700, matching the karrierenmin.no web wordmark. Fallback chain remains Helvetica Neue → Arial → sans-serif.
- **CSS styling for the AI Maturity section**: `.ai-maturity`, `.ai-score-card`, `.ai-signal-table`, `.ai-not-applicable`.

### Fixed
- **Cover wordmark truncation**: `assets/logo.svg` previously had a viewBox of 360 wide that clipped the trailing ".no" depending on font fallback. ViewBox widened to 420, letter-spacing tightened to -0.18 units (matching the -0.005em web wordmark), and `.cover-logo-area svg` width increased from 280px to 320px. The same fix applied to `assets/logo-footer.svg`.
- **Body font now matches the karrierenmin.no web identity**: previously `Inter` was first in the cascade. Now `IBM Plex Sans` is the primary font and headings use `letter-spacing: -0.005em` per the web style guide.
- **Report submission now works out-of-the-box**: credentials are now read from `config.json` in the skill package instead of requiring environment variable setup. Users do not need to configure anything to submit reports to karrierenmin.no's database.

### Changed
- `references/extended_report_outline.md`: updated page budget (22–27 pages) and search budget (85 searches) to reflect the new AI Maturity section.
- `references/data_sources_per_country.md`: search-strategy notes updated with rules for Miljøfyrtårn (neutral baseline), jobbi.no (three independent reviews minimum), ISO (verify against certifying body), GDPR (36-month window), and AI Maturity (three of five signal categories minimum).
- `scripts/render_report.py`: new `_ai_maturity_html()` function and `ai_maturity_posture` key now consumed in `_extended_block`.
- `scripts/submit_report.py`: new `_load_config()` function loads credentials from `config.json` (first priority) or environment variables (fallback). Docstring updated to reflect the new configuration order.
- `assets/styles.css`: Google Fonts `@import` for IBM Plex Sans, updated font cascades, and new AI Maturity styles.
- `INSTALL.md`: submission documentation simplified — users no longer need to set environment variables. For custom deployments, edit `config.json` before packaging.

### Migration notes
- No breaking schema changes. v1.1 report data renders correctly in v1.2 — AI Maturity is optional and the section is simply omitted if `ai_maturity_posture` is missing.
- IBM Plex Sans requires internet access at render time to fetch from Google Fonts. If the renderer runs offline, weasyprint falls back to Helvetica Neue → Arial → sans-serif. To embed the font fully offline, download `IBMPlexSans-{Light,Regular,Medium,SemiBold,Bold}.woff2` to `assets/fonts/` and replace the `@import` with `@font-face` rules.
- The cover SVG fix is automatic; replace `assets/logo.svg` and `assets/logo-footer.svg` in any custom branding workflow.
- Environment variables `SUPABASE_ENDPOINT` and `SUPABASE_ANON_KEY` are still respected as a fallback for users who prefer to configure via environment. The configuration resolution order is: `config.json` → environment variables → (skip submission).

## [1.1.0] — 2026-05-20

### Fixed
- Methodology page no longer renders mixed-language output. The scoring scale table rows, the Insufficient Evidence explainer, the Sourced/Inferred bullet descriptions and the Citation conventions sentence were previously hardcoded in English in both HTML templates and bypassed the i18n layer. They are now sourced from `scripts/i18n.py` and translated for all twelve supported languages.

### Added
- Nine new i18n keys in every language pack: `score_1_desc`, `score_2_desc`, `score_3_desc`, `score_4_desc`, `score_5_desc`, `insufficient_evidence_explainer`, `sourced_explainer`, `inferred_explainer`, `citation_traceability_note`.
- New regression test `tests/test_language_consistency.py`. It renders a minimal payload for every supported language at both tiers and asserts:
  - No canonical English methodology phrase leaks into any non-English render.
  - No `{{LBL_*}}` template token remains unresolved after substitution.
  - The English render still contains the canonical strings (positive control).
- The test exits with code 0 on success and code 1 on any failure, suitable for CI gating.

### Changed
- `assets/template_standard.html` and `assets/template_extended.html`: hardcoded English methodology strings replaced with `{{LBL_*}}` tokens.
- `scripts/render_report.py`: substitutions dictionary extended with the nine new tokens.
- `references/report_methodology.md`: clarified that `scripts/i18n.py` is the source of truth for methodology wording, and that this markdown file is reference-only.

### Migration notes
- No JSON schema changes. Existing report data files from v1.0 render correctly under v1.1.
- The standard-tier methodology page lost two minor clarifying clauses ("or when sources are too generic to support a substantive assessment" on the Insufficient Evidence paragraph, and "Direct quotes are kept under fifteen words" on the Citation note). The shorter wording matches the extended tier and avoids divergence. If the longer clauses are needed back, extend the relevant i18n keys in all twelve packs.

## [1.0.0] — initial release
- Eight-dimension employer analysis with radar chart, standard and extended tiers, PDF rendering via weasyprint, twelve language packs, anonymized submission endpoint.
