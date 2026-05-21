# Installation and Usage

How to install and use the `employer-analysis` skill in Claude or Claude Code.

## What this skill does

Produces an evidence-based PDF report on a European employer for prospective employees. The report scores the company across eight dimensions, includes a radar chart, methodology, dimension detail, synthesis, source list, and search log.

Two report tiers:

- **Standard** — 8 to 10 pages.
- **Extended** — 20 to 25 pages with peer benchmark, news timeline, leadership profiles, compensation signals, sentiment trend, ESG section, and scenario notes.

Twelve report languages: Norwegian Bokmål, Swedish, Danish, Finnish, Icelandic, German, Dutch, French, English, Spanish, Portuguese, Italian.

In-scope countries: Norway, Sweden, Denmark, Finland, Iceland, Germany, Austria, Switzerland, Netherlands, Belgium, Luxembourg, France, United Kingdom, Spain, Portugal, Italy.

Produced by KarrierenMin.no.

## Install in Claude.ai

1. Open Claude.ai in your browser.
2. Go to Settings, Capabilities, Skills.
3. Click Upload skill and select the `employer-analysis.skill` file.
4. The skill becomes available in new conversations.

To trigger, start a new conversation. Three trigger patterns work:

- Type the skill name only, for example `employer-analysis`. The skill runs the interactive intake and asks for company name, domain, country, language, and tier.
- Provide a partial query, for example "Analyze siemens.com as an employer in Germany". The skill asks for missing pieces.
- Provide everything in one message: "Analyze Siemens AG, domain siemens.com, country DE, language de, extended report".

## Install in Claude Code

1. Locate your Claude Code skills directory:
   - macOS and Linux: `~/.claude/skills/`
   - Windows: `%USERPROFILE%\.claude\skills\`

2. Unpack the .skill file (it is a standard zip archive):

```bash
unzip employer-analysis.skill -d ~/.claude/skills/
```

This creates `~/.claude/skills/employer-analysis/` with `SKILL.md` at the root.

3. Install Python dependencies:

```bash
pip install weasyprint
```

On macOS install Cairo, Pango, and gdk-pixbuf via Homebrew first:

```bash
brew install cairo pango gdk-pixbuf libffi
```

On Debian-based Linux:

```bash
apt-get install libpango-1.0-0 libpangoft2-1.0-0
```

4. Restart Claude Code. The skill triggers on the same phrases as in Claude.ai.

## Required input

The skill collects five values during interactive intake. None are inferred from the company name alone.

| Input | Format | Example |
|---|---|---|
| Company name | Full legal or commonly used name | Siemens AG |
| Domain | Primary web address (no protocol or path) | siemens.com |
| Country | ISO Alpha-2 code | DE |
| Report language | ISO 639-1 code from the supported twelve | de |
| Report tier | standard or extended | extended |

## Pre-flight model check (extended only)

When the user selects the extended tier, the skill performs a pre-flight model check before any research begins. The skill identifies the active model. If the active model is not the flagship for the running platform (Opus 4.7 on Claude, or the platform equivalent), the skill issues a warning to the user but continues. The warning is also recorded in the report's methodology page so the reader can see which model produced the report.

The warning never blocks the run. The user can choose to proceed on any model.

## Anonymous submission to KarrierenMin.no database

This skill submits an anonymized payload of each generated report to a Supabase Edge function operated by KarrierenMin.no, by default. The purpose is to build a public-good database of employer analyses across Europe.

What is sent:

- Company name, domain, branch country, parent country (if any), analysis date
- Overall score and per-dimension scores with sourced/inferred labels
- Source count, search count, language, tier, scope deviation flag

What is not sent:

- No user identifier of any kind
- No PDF binary
- No raw search results
- No direct quotes
- No leadership profile data or scenario notes

How submission works:

The skill reads Supabase credentials from `config.json` in the skill package. This file contains the endpoint URL and public anon key for the ingest function. All users who install the skill automatically send reports without needing any configuration.

How to disable submission:

- Pass `--no-submit` on the renderer command line, or
- Set `runtime.consent_to_submit` to `false` in the report data JSON

For custom deployments: if you want to ingest reports to your own Supabase instance, replace the endpoint and key in `config.json` before packaging the skill.

The submission status (sent or skipped) appears in the renderer's stdout. The skill informs the user of the submission default during interactive intake and asks for an opt-out decision before running.

## Configuration (for custom deployments)

If you are deploying a custom version of this skill to your own Supabase instance, edit `config.json`:

```json
{
  "supabase_endpoint": "https://your-project.supabase.co/functions/v1/ingest-report",
  "supabase_anon_key": "your-anon-key-here"
}
```

The anon key is safe to include in the package — it has INSERT-only permissions on the ingest table.

## What you get

A PDF saved to `/mnt/user-data/outputs/` (Claude.ai) or your local working directory (Claude Code), with this structure:

Standard tier:

- Page 1: Cover
- Page 2: Executive summary with overall score, radar chart, score-card grid, key findings
- Page 3: Methodology and definitions
- Pages 4 to 8: Detailed dimension review
- Page 9: Synthesis and disclaimer
- After page 9: Numbered source list and full search log

Extended tier:

- Same first three pages
- Detailed dimension review (4 pages)
- Peer benchmark, news timeline, leadership profiles, compensation signals, sentiment trend, ESG section, scenario notes (9 to 13 pages)
- Synthesis and disclaimer
- Source list and search log (3 to 5 pages)

Filename pattern: `employer-analysis-<company>-<language>-<YYYYMMDD>.pdf`

## Customizing branding

Logo: replace `assets/logo.png`. Suggested 200x60 pixels at 72 dpi.

Accent color: pass `--accent "#hexcode"` on the renderer command, or change `DEFAULT_ACCENT` in `scripts/render_report.py`.

Producer name in footer: edit the `@bottom-center` content in `assets/styles.css` and the cover lines in the two HTML templates.

## File structure

```
employer-analysis/
├── SKILL.md
├── INSTALL.md
├── scripts/
│   ├── render_report.py
│   ├── generate_radar.py
│   ├── source_registry.py
│   ├── i18n.py
│   └── submit_report.py
├── references/
│   ├── scoring_rubric.md
│   ├── data_sources_per_country.md
│   ├── report_methodology.md
│   ├── extended_report_outline.md
│   └── language_codes.md
└── assets/
    ├── template_standard.html
    ├── template_extended.html
    ├── styles.css
    └── logo.png
```

## Limitations

The skill is calibrated for the sixteen listed European countries. Companies outside this scope can still be analyzed, but the report will mark the scope deviation explicitly.

Public source coverage varies. Very small private companies in countries with limited disclosure may have one or more dimensions flagged as insufficient_evidence.

Web search results reflect the date of analysis. Re-run if material changes have occurred since the previous report.

The skill does not perform candidate matching. It assesses the employer, not the fit for a specific candidate.

Version: 2.0
