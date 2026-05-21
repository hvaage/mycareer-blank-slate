#!/usr/bin/env python3
"""PDF renderer for the employer-analysis skill.

Takes report data as JSON, renders an HTML template in the chosen language
and tier (standard or extended), and produces a PDF via weasyprint.
Optionally submits an anonymized payload to a configured Supabase endpoint.

Usage:
    python render_report.py --data report.json --language nb --tier standard \\
        --output report.pdf

Or programmatically:
    from render_report import render_pdf
    render_pdf(report_data, output_path, language="nb", tier="standard")

Expected report_data schema (Python dict / JSON):

{
  "company": {
    "name": "Equinor ASA",
    "domain": "equinor.com",
    "branch_entity": "Equinor ASA",
    "branch_country": "Norway",
    "parent_entity": null,
    "parent_country": null,
    "analysis_date": "2026-05-19"
  },
  "overall": {
    "score": 4.1,
    "scored_dimensions": 7,
    "total_dimensions": 8
  },
  "executive_bullets": ["..."],
  "dimensions": [ ... 8 entries ... ],
  "synthesis_paragraphs": ["..."],
  "sources": [ {"id": 1, "title": "...", "publisher": "...", "url": "...", "date": "..."} ],
  "search_log": [ {"query": "...", "results": 10} ],
  "scope_deviation": false,

  # Optional (extended tier only)
  "peer_benchmark": {"peers": [...], "narrative": "..."},
  "news_timeline": [ {"date": "...", "headline": "...", "source_id": N} ],
  "leadership_profiles": [ {"name": "...", "role": "...", "tenure": "...", "notes": "..."} ],
  "compensation_signals": {"narrative": "...", "data_points": [...]},
  "sentiment_trend": {"narrative": "...", "data_points": [...]},
  "esg_section": {"narrative": "...", "highlights": [...]},
  "scenario_notes": ["..."],

  # Runtime metadata
  "runtime": {
    "model_name": "claude-opus-4-7",
    "model_is_flagship": true,
    "consent_to_submit": true
  }
}
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
ASSETS_DIR = SKILL_DIR / "assets"

sys.path.insert(0, str(SCRIPT_DIR))

from generate_radar import build_radar_svg  # noqa: E402
from i18n import get_pack, is_supported  # noqa: E402
from submit_report import submit_anonymous  # noqa: E402


DEFAULT_ACCENT = "#2C5282"
VALID_TIERS = ("standard", "extended")


# ----- HTML helpers -----

def _esc(s):
    if s is None:
        return ""
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _score_bar(score, accent):
    if score is None:
        return (
            '<div class="score-bar insufficient">'
            '<span class="bar-fill" style="width: 0%"></span>'
            "</div>"
        )
    pct = max(0, min(100, (score / 5.0) * 100))
    return (
        f'<div class="score-bar">'
        f'<span class="bar-fill" style="width: {pct:.1f}%; background: {accent};"></span>'
        f"</div>"
    )


def _score_display(score, insufficient_label):
    if score is None:
        return f'<span class="insufficient-pill">{_esc(insufficient_label)}</span>'
    return f'<span class="score-number">{score:.1f}</span><span class="score-max">/5.0</span>'


def _label_badge(label, pack):
    if label == "sourced":
        return f'<span class="badge sourced">{_esc(pack["sourced"])}</span>'
    if label == "inferred":
        return f'<span class="badge inferred">{_esc(pack["inferred"])}</span>'
    return f'<span class="badge insufficient">{_esc(pack["insufficient_evidence"])}</span>'


def _dimension_section(dim, accent, pack):
    quotes_html = ""
    if dim.get("quotes"):
        quotes_html = '<div class="quotes">'
        for q in dim["quotes"]:
            ref = f' <sup>[{q["source_id"]}]</sup>' if q.get("source_id") else ""
            quotes_html += f'<blockquote>"{_esc(q["text"])}"{ref}</blockquote>'
        quotes_html += "</div>"

    sources_html = ""
    if dim.get("source_ids"):
        ids = ", ".join(f"[{i}]" for i in dim["source_ids"])
        sources_html = (
            f'<p class="dim-sources"><strong>{_esc(pack["sources_label"])}</strong> {ids}</p>'
        )

    what_html = ""
    if dim.get("what_it_means"):
        what_html = (
            f'<h3>{_esc(pack["what_it_means"])}</h3>'
            f'<p class="what-it-means">{_esc(dim["what_it_means"])}</p>'
        )

    return f"""
    <section class="dimension">
      <div class="score-card">
        <div class="card-header">
          <h2>{_esc(dim["name"])}</h2>
          {_label_badge(dim.get("label", "insufficient"), pack)}
        </div>
        <div class="card-score-row">
          <div class="card-score">{_score_display(dim.get("score"), pack["insufficient_evidence"])}</div>
          {_score_bar(dim.get("score"), accent)}
        </div>
      </div>
      <p class="rationale">{_esc(dim.get("rationale", ""))}</p>
      {quotes_html}
      {sources_html}
      {what_html}
    </section>
    """


def _exec_summary_grid(dimensions, accent, pack):
    cells = []
    for dim in dimensions:
        score_html = _score_display(dim.get("score"), pack["insufficient_evidence"])
        bar_html = _score_bar(dim.get("score"), accent)
        cells.append(
            f'<div class="summary-card">'
            f'<div class="summary-name">{_esc(dim["name"])}</div>'
            f'<div class="summary-score">{score_html}</div>'
            f"{bar_html}"
            f"</div>"
        )
    return '<div class="summary-grid">' + "".join(cells) + "</div>"


def _build_radar_data(dimensions):
    return {d["name"]: d.get("score") for d in dimensions}


def _format_date(date_str):
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        return dt.strftime("%B %d, %Y")
    except (TypeError, ValueError):
        return date_str or ""


def _build_entity_line(company):
    branch = _esc(company.get("branch_entity") or company.get("name"))
    branch_country = _esc(company.get("branch_country", ""))
    parent = company.get("parent_entity")
    if parent:
        parent_country = _esc(company.get("parent_country", ""))
        return f"{branch} ({branch_country}), {parent} ({parent_country})"
    return f"{branch} ({branch_country})"


# ----- Extended tier section builders -----

def _peer_benchmark_html(data, pack):
    if not data:
        return ""
    rows = ""
    for p in data.get("peers", []) or []:
        rows += (
            f"<tr><td>{_esc(p.get('name'))}</td>"
            f"<td>{_esc(p.get('country', ''))}</td>"
            f"<td>{_esc(p.get('score_overall', ''))}</td>"
            f"<td>{_esc(p.get('note', ''))}</td></tr>"
        )
    table = ""
    if rows:
        table = (
            '<table class="ext-table"><tr><th>Peer</th><th>Country</th><th>Overall</th><th>Note</th></tr>'
            + rows + "</table>"
        )
    narrative = f"<p>{_esc(data.get('narrative', ''))}</p>" if data.get("narrative") else ""
    return f'<section class="ext-section"><h2>{_esc(pack["peer_benchmark_title"])}</h2>{narrative}{table}</section>'


def _news_timeline_html(data, pack):
    if not data:
        return ""
    items = ""
    for item in data:
        ref = f' <sup>[{item["source_id"]}]</sup>' if item.get("source_id") else ""
        items += (
            f'<li><strong>{_esc(item.get("date", ""))}</strong> — '
            f'{_esc(item.get("headline", ""))}{ref}</li>'
        )
    return (
        f'<section class="ext-section"><h2>{_esc(pack["news_timeline_title"])}</h2>'
        f'<ul class="timeline">{items}</ul></section>'
    )


def _leadership_profiles_html(data, pack):
    if not data:
        return ""
    cards = ""
    for p in data:
        cards += (
            '<div class="leader-card">'
            f'<h3>{_esc(p.get("name", ""))} — {_esc(p.get("role", ""))}</h3>'
            f'<p class="tenure">{_esc(p.get("tenure", ""))}</p>'
            f'<p>{_esc(p.get("notes", ""))}</p>'
            "</div>"
        )
    return (
        f'<section class="ext-section"><h2>{_esc(pack["leadership_profiles_title"])}</h2>'
        f'{cards}</section>'
    )


def _generic_narrative_section(data, title):
    if not data:
        return ""
    narrative = data.get("narrative", "")
    points = data.get("data_points") or data.get("highlights") or []
    points_html = ""
    if points:
        points_html = "<ul>" + "".join(f"<li>{_esc(str(p))}</li>" for p in points) + "</ul>"
    return (
        f'<section class="ext-section"><h2>{_esc(title)}</h2>'
        f'<p>{_esc(narrative)}</p>{points_html}</section>'
    )


def _scenario_notes_html(data, pack):
    if not data:
        return ""
    items = "".join(f"<li>{_esc(s)}</li>" for s in data)
    return (
        f'<section class="ext-section"><h2>{_esc(pack["scenario_notes_title"])}</h2>'
        f'<ul>{items}</ul></section>'
    )


def _ai_maturity_html(data, pack, accent):
    """Render the AI Maturity Posture section for the extended tier.

    Handles two cases:
      - applicable=false: shows the title and a one-line applicability note.
      - applicable=true: shows score, narrative, five signal categories and
        key evidence bullets.
    """
    if not data:
        return ""

    title = _esc(pack["ai_maturity_title"])
    intro = _esc(pack["ai_maturity_intro"])

    if not data.get("applicable", True):
        note = _esc(data.get("applicability_note", "")) or _esc(pack["ai_maturity_not_applicable"])
        return (
            f'<section class="ext-section ai-maturity"><h2>{title}</h2>'
            f'<p class="appendix-intro">{intro}</p>'
            f'<div class="ai-not-applicable">'
            f'<strong>{_esc(pack["ai_maturity_not_applicable"])}.</strong> {note}'
            f'</div></section>'
        )

    score_val = data.get("score")
    score_html = ""
    if score_val is not None:
        try:
            score_str = f"{float(score_val):.1f}"
        except (TypeError, ValueError):
            score_str = str(score_val)
        score_html = (
            '<div class="ai-score-card">'
            f'<span class="overall-label">{title}</span>'
            f'<div><span class="overall-score">{score_str}</span>'
            f'<span class="overall-max"> / 5.0</span></div>'
            '</div>'
        )

    narrative = _esc(data.get("narrative", ""))
    narrative_html = f'<p>{narrative}</p>' if narrative else ""

    signals = data.get("signals") or {}
    signal_rows = ""
    signal_map = [
        ("strategy_and_leadership", "ai_signal_strategy"),
        ("capability_and_deployment", "ai_signal_capability"),
        ("workforce", "ai_signal_workforce"),
        ("governance", "ai_signal_governance"),
        ("market_and_product", "ai_signal_market"),
    ]
    for key, pack_key in signal_map:
        value = signals.get(key)
        if not value:
            continue
        signal_rows += (
            f'<tr><th>{_esc(pack[pack_key])}</th>'
            f'<td>{_esc(value)}</td></tr>'
        )
    signal_html = ""
    if signal_rows:
        signal_html = f'<table class="ext-table ai-signal-table">{signal_rows}</table>'

    evidence = data.get("key_evidence") or []
    evidence_html = ""
    if evidence:
        items = "".join(f"<li>{_esc(e)}</li>" for e in evidence)
        evidence_html = (
            f'<h3>{_esc(pack["ai_key_evidence_label"])}</h3>'
            f'<ul>{items}</ul>'
        )

    sources = data.get("source_ids") or []
    sources_html = ""
    if sources:
        ids = ", ".join(f"[{i}]" for i in sources)
        sources_html = f'<p class="dim-sources">{_esc(pack["sources_label"])} {ids}</p>'

    return (
        f'<section class="ext-section ai-maturity"><h2>{title}</h2>'
        f'<p class="appendix-intro">{intro}</p>'
        f'{score_html}{narrative_html}{signal_html}{evidence_html}{sources_html}'
        '</section>'
    )


def _extended_block(report_data, pack):
    """Render the extra extended sections (or empty string for standard tier)."""
    parts = [
        _peer_benchmark_html(report_data.get("peer_benchmark"), pack),
        _news_timeline_html(report_data.get("news_timeline"), pack),
        _leadership_profiles_html(report_data.get("leadership_profiles"), pack),
        _generic_narrative_section(report_data.get("compensation_signals"), pack["compensation_signals_title"]),
        _generic_narrative_section(report_data.get("sentiment_trend"), pack["sentiment_trend_title"]),
        _generic_narrative_section(report_data.get("esg_section"), pack["esg_section_title"]),
        _ai_maturity_html(report_data.get("ai_maturity_posture"), pack, DEFAULT_ACCENT),
        _scenario_notes_html(report_data.get("scenario_notes"), pack),
    ]
    block = "".join(p for p in parts if p)
    if not block:
        return ""
    return f'<section class="page extended-block">{block}</section>'


# ----- Main render -----

REQUIRED_COVER_ASSETS = ("logo.svg", "logo-footer.svg", "styles.css")


def _assert_cover_assets():
    """Fail loudly if the locked cover assets are missing.

    Prevents Claude from silently producing a PDF without the
    KarrierenMin branding when the skill has been unpacked incompletely.
    """
    missing = [
        name for name in REQUIRED_COVER_ASSETS
        if not (ASSETS_DIR / name).exists()
    ]
    if missing:
        raise FileNotFoundError(
            "Required cover assets missing from assets/: "
            + ", ".join(missing)
            + ". The skill bundle is incomplete — do NOT improvise a cover. "
            "Re-install the .skill file."
        )


def _template_path(tier):
    name = "template_extended.html" if tier == "extended" else "template_standard.html"
    return ASSETS_DIR / name


def render_html(report_data, language="en", tier="standard", accent=DEFAULT_ACCENT):
    if not is_supported(language):
        raise ValueError(f"Unsupported language: {language!r}")
    if tier not in VALID_TIERS:
        raise ValueError(f"Invalid tier: {tier!r}. Use one of {VALID_TIERS}")

    pack = get_pack(language)
    company = report_data["company"]
    overall = report_data["overall"]
    runtime = report_data.get("runtime", {}) or {}

    radar_svg = build_radar_svg(
        _build_radar_data(report_data["dimensions"]),
        accent_color=accent,
    )

    template = _template_path(tier).read_text(encoding="utf-8")
    stylesheet = (ASSETS_DIR / "styles.css").read_text(encoding="utf-8")
    stylesheet = stylesheet.replace("__ACCENT__", accent)
    logo_footer_url = (ASSETS_DIR / "logo-footer.svg").resolve().as_uri()
    stylesheet = stylesheet.replace("__LOGO_FOOTER_URL__", logo_footer_url)
    try:
        logo_svg_inline = (ASSETS_DIR / "logo.svg").read_text(encoding="utf-8")
        # Strip XML prolog so the SVG embeds cleanly inside HTML
        if logo_svg_inline.lstrip().startswith("<?xml"):
            logo_svg_inline = logo_svg_inline.split("?>", 1)[1].lstrip()
    except FileNotFoundError:
        logo_svg_inline = '<span class="cover-brand">KarrierenMin.no</span>'

    exec_bullets = "".join(
        f"<li>{_esc(b)}</li>" for b in report_data.get("executive_bullets", [])
    )

    dimensions_html = "\n".join(
        _dimension_section(d, accent, pack) for d in report_data["dimensions"]
    )

    summary_grid = _exec_summary_grid(report_data["dimensions"], accent, pack)

    synthesis_html = "".join(
        f"<p>{_esc(p)}</p>" for p in report_data.get("synthesis_paragraphs", [])
    )

    sources_html = ""
    for src in report_data.get("sources", []):
        sources_html += (
            f"<li id='src-{src['id']}'>"
            f"<strong>[{src['id']}]</strong> {_esc(src.get('title', ''))}. "
            f"{_esc(src.get('publisher', ''))}. "
            f"<a href='{_esc(src.get('url', ''))}'>{_esc(src.get('url', ''))}</a>. "
            f"{_esc(src.get('date', ''))}"
            f"</li>"
        )

    log_html = ""
    for entry in report_data.get("search_log", []):
        results = entry.get("results", "")
        log_html += (
            f"<li><code>{_esc(entry['query'])}</code> — "
            f"<em>{_esc(results)} results</em></li>"
        )

    overall_score_display = (
        f"{overall['score']:.1f}" if overall.get("score") is not None else "N/A"
    )
    scored_note = pack["scored_note_template"].format(
        n=overall.get("scored_dimensions", "?"),
        m=overall.get("total_dimensions", 8),
    )

    scope_note = ""
    if report_data.get("scope_deviation"):
        scope_note = (
            f'<p class="scope-deviation"><strong>Note:</strong> '
            f'{_esc(pack["scope_deviation_note"])}</p>'
        )

    model_note = ""
    if runtime.get("model_name"):
        model_line = f'{pack["model_label"]} {runtime.get("model_name")}'
        if runtime.get("model_is_flagship") is False:
            model_line += f' — {pack["model_warning"]}'
        model_note = f'<p class="model-note"><em>{_esc(model_line)}</em></p>'

    extended_html = _extended_block(report_data, pack) if tier == "extended" else ""

    substitutions = {
        "{{STYLESHEET}}": stylesheet,
        "{{LOGO_SVG}}": logo_svg_inline,
        "{{ACCENT}}": accent,
        "{{COMPANY_NAME}}": _esc(company.get("name", "")),
        "{{ENTITY_LINE}}": _build_entity_line(company),
        "{{ANALYSIS_DATE}}": _esc(_format_date(company.get("analysis_date", ""))),
        "{{FOOTER_DATE}}": _esc(_format_date(company.get("analysis_date", ""))),
        "{{OVERALL_SCORE}}": overall_score_display,
        "{{SCORED_NOTE}}": _esc(scored_note),
        "{{RADAR_SVG}}": radar_svg,
        "{{SUMMARY_GRID}}": summary_grid,
        "{{EXEC_BULLETS}}": exec_bullets,
        "{{SCOPE_DEVIATION}}": scope_note,
        "{{MODEL_NOTE}}": model_note,
        "{{ENTITY_SCOPE_STATEMENT}}": _build_entity_line(company),
        "{{DIMENSIONS}}": dimensions_html,
        "{{SYNTHESIS}}": synthesis_html,
        "{{SOURCES}}": sources_html,
        "{{SEARCH_LOG}}": log_html,
        "{{EXTENDED_BLOCK}}": extended_html,

        # i18n labels
        "{{LBL_REPORT_TITLE}}": _esc(pack["report_title"]),
        "{{LBL_COVER_EYEBROW}}": _esc(pack["cover_eyebrow"]),
        "{{LBL_ANALYSIS_DATE}}": _esc(pack["analysis_date_label"]),
        "{{LBL_PRODUCED_BY}}": _esc(pack["produced_by_label"]),
        "{{LBL_CONFIDENTIAL}}": _esc(pack["confidential_note"]),
        "{{LBL_EXEC_SUMMARY}}": _esc(pack["exec_summary"]),
        "{{LBL_OVERALL_SCORE}}": _esc(pack["overall_score"]),
        "{{LBL_DIM_SCORES}}": _esc(pack["dim_scores_at_glance"]),
        "{{LBL_KEY_FINDINGS}}": _esc(pack["key_findings"]),
        "{{LBL_METHODOLOGY}}": _esc(pack["methodology_title"]),
        "{{LBL_GEO_SCOPE}}": _esc(pack["geographic_scope"]),
        "{{LBL_SCORING_SCALE}}": _esc(pack["scoring_scale"]),
        "{{LBL_INSUFFICIENT}}": _esc(pack["insufficient_evidence"]),
        "{{LBL_SOURCED_VS_INFERRED}}": _esc(pack["sourced_vs_inferred"]),
        "{{LBL_CITATION_CONV}}": _esc(pack["citation_conventions"]),
        "{{LBL_DETAILED_REVIEW}}": _esc(pack["detailed_review"]),
        "{{LBL_SYNTHESIS}}": _esc(pack["synthesis_title"]),
        "{{LBL_OVERALL_ASSESSMENT}}": _esc(pack["overall_assessment"]),
        "{{LBL_DISCLAIMER}}": _esc(pack["disclaimer_title"]),
        "{{LBL_SOURCE_LIST}}": _esc(pack["source_list_title"]),
        "{{LBL_SEARCH_LOG}}": _esc(pack["search_log_title"]),
        "{{LBL_SEARCH_LOG_INTRO}}": _esc(pack["search_log_intro"]),
        "{{LBL_PAGE}}": _esc(pack["page_word"]),
        "{{LBL_SCORE_MEANING}}": _esc(pack["score_meaning"]),
        "{{LBL_SCORE_HEADER}}": _esc(pack["score_header"]),
        "{{LBL_SOURCED}}": _esc(pack["sourced"]),
        "{{LBL_INFERRED}}": _esc(pack["inferred"]),
        "{{LBL_SCORE_1_DESC}}": _esc(pack["score_1_desc"]),
        "{{LBL_SCORE_2_DESC}}": _esc(pack["score_2_desc"]),
        "{{LBL_SCORE_3_DESC}}": _esc(pack["score_3_desc"]),
        "{{LBL_SCORE_4_DESC}}": _esc(pack["score_4_desc"]),
        "{{LBL_SCORE_5_DESC}}": _esc(pack["score_5_desc"]),
        "{{LBL_INSUFFICIENT_EXPLAINER}}": _esc(pack["insufficient_evidence_explainer"]),
        "{{LBL_SOURCED_EXPLAINER}}": _esc(pack["sourced_explainer"]),
        "{{LBL_INFERRED_EXPLAINER}}": _esc(pack["inferred_explainer"]),
        "{{LBL_CITATION_TRACEABILITY_NOTE}}": _esc(pack["citation_traceability_note"]),
        "{{DISCLAIMER_TEXT}}": _esc(pack["disclaimer_text"]),
    }

    html = template
    for key, value in substitutions.items():
        html = html.replace(key, value)

    return html


def render_pdf(report_data, output_path, language="en", tier="standard", accent=DEFAULT_ACCENT):
    _assert_cover_assets()
    try:
        import weasyprint
        from weasyprint import HTML
    except ImportError as exc:
        raise RuntimeError(
            "WeasyPrint is required to render the employer-analysis PDF. "
            "Run: pip install weasyprint\n"
            "Do NOT fall back to markdown-to-PDF or any other renderer — "
            "the bundled template and KarrierenMin branding only work with "
            "WeasyPrint."
        ) from exc
    print(
        f"[render_report] WeasyPrint {weasyprint.__version__} — "
        f"tier={tier} language={language} -> {output_path}",
        file=sys.stderr,
    )
    html_str = render_html(report_data, language=language, tier=tier, accent=accent)
    HTML(string=html_str, base_url=str(SKILL_DIR)).write_pdf(output_path)
    print(f"[render_report] Wrote PDF: {Path(output_path).resolve()}", file=sys.stderr)
    return output_path


def main():
    parser = argparse.ArgumentParser(description="Render employer analysis report from JSON to PDF")
    parser.add_argument("--data", required=True, help="Path to report data JSON")
    parser.add_argument("--output", required=True, help="Path for the output PDF")
    parser.add_argument("--language", default="en", help="ISO 639-1 language code")
    parser.add_argument("--tier", default="standard", choices=VALID_TIERS, help="Report tier")
    parser.add_argument("--accent", default=DEFAULT_ACCENT, help="Accent color hex")
    parser.add_argument("--html-only", action="store_true", help="Write HTML instead of PDF")
    parser.add_argument(
        "--no-submit",
        action="store_true",
        help="Skip the anonymized submission to the configured Supabase endpoint",
    )
    args = parser.parse_args()

    data_path = Path(args.data)
    if not data_path.exists():
        print(f"Error: data file not found: {data_path}", file=sys.stderr)
        sys.exit(1)

    with data_path.open("r", encoding="utf-8") as f:
        report_data = json.load(f)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if args.html_only:
        html_str = render_html(report_data, language=args.language, tier=args.tier, accent=args.accent)
        output_path.write_text(html_str, encoding="utf-8")
        print(f"Wrote HTML to {output_path}")
    else:
        render_pdf(report_data, str(output_path), language=args.language, tier=args.tier, accent=args.accent)
        print(f"Wrote PDF to {output_path}")

    # Anonymous submission. Default ON. Disabled when --no-submit is passed
    # or when the user opted out (runtime.consent_to_submit == false).
    runtime = report_data.get("runtime", {}) or {}
    consent = runtime.get("consent_to_submit", True) and not args.no_submit
    result = submit_anonymous(
        report_data,
        consent=consent,
        tier=args.tier,
        language=args.language,
    )
    if result["sent"]:
        print(f"Submitted anonymized payload (status {result['status_code']})")
    else:
        print(f"Submission skipped: {result['reason']}")


if __name__ == "__main__":
    main()
