"""Regression test for language consistency across rendered reports.

Purpose
-------
Verify that the rendered HTML for any non-English language does NOT contain
canonical English methodology phrases. This catches the class of bugs where
hardcoded English strings in templates bypass the i18n layer.

The test renders a minimal valid report payload for every supported language
and asserts:
  1. For language != "en": none of the canonical English methodology strings
     appear in the rendered HTML.
  2. For language == "en": the canonical strings DO appear, confirming the
     test itself is wired up correctly.
  3. All declared {{LBL_*}} tokens in either template are actually substituted
     (no unresolved tokens remain in the output).

Run from the skill root:

    python tests/test_language_consistency.py

Exits with code 0 on success, 1 on any failure.
"""

import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
sys.path.insert(0, str(SKILL_DIR / "scripts"))

from i18n import LANGUAGE_PACKS  # noqa: E402
from render_report import render_html  # noqa: E402


# Canonical English methodology phrases that should NEVER appear in a non-English render.
ENGLISH_LEAK_PHRASES = [
    "Significant concern with concrete evidence",
    "Below average, multiple weak signals",
    "Neutral baseline or mixed evidence",
    "Above average, multiple supporting signals",
    "Strong and well-evidenced across independent sources",
    "A dimension is flagged as",
    "directly supported by independent external sources",
    "derived from logical reasoning over indirect signals",
    "Every claim is traceable to a numbered source",
]


def _minimal_report_data():
    """Return a minimal but schema-complete payload for rendering."""
    return {
        "company": {
            "name": "TestCo",
            "domain": "testco.example",
            "branch_entity": "TestCo AS",
            "branch_country": "Norge",
            "parent_entity": None,
            "parent_country": None,
            "analysis_date": "2026-05-20",
        },
        "overall": {"score": 3.5, "scored_dimensions": 8, "total_dimensions": 8},
        "executive_bullets": ["Bullet one for the test payload."],
        "dimensions": [
            {
                "name": f"Dim {i}",
                "score": 3.5,
                "label": "sourced",
                "rationale": "Rasjonale for testpayload.",
                "source_ids": [1],
            }
            for i in range(1, 9)
        ],
        "synthesis_paragraphs": ["Syntese for testpayload."],
        "sources": [
            {"id": 1, "title": "Testkilde", "publisher": "Test", "url": "https://example.com", "date": "2026-05"},
        ],
        "search_log": [{"query": "test", "results": 1}],
        "scope_deviation": False,
        "runtime": {"model_name": "test-model", "model_is_flagship": True, "consent_to_submit": False},
    }


def _unresolved_tokens(html: str):
    """Return any {{TOKEN}} patterns still present in the rendered HTML."""
    return re.findall(r"\{\{[A-Z0-9_]+\}\}", html)


def test_all_languages(tier: str):
    """Render each supported language at the given tier and assert no English leakage."""
    failures = []
    data = _minimal_report_data()

    for lang in LANGUAGE_PACKS.keys():
        html = render_html(data, language=lang, tier=tier)

        # Check for unresolved template tokens
        unresolved = _unresolved_tokens(html)
        if unresolved:
            failures.append(
                f"[{tier}/{lang}] unresolved template tokens: {sorted(set(unresolved))}"
            )

        # Check for English leakage in non-English renders
        if lang != "en":
            leaked = [p for p in ENGLISH_LEAK_PHRASES if p in html]
            if leaked:
                failures.append(
                    f"[{tier}/{lang}] English methodology strings leaked into output: {leaked}"
                )
        else:
            # Positive control: English render MUST contain the canonical strings.
            missing = [p for p in ENGLISH_LEAK_PHRASES if p not in html]
            if missing:
                failures.append(
                    f"[{tier}/en] expected English strings missing from English render: {missing}"
                )

    return failures


def main():
    all_failures = []
    for tier in ("standard", "extended"):
        all_failures.extend(test_all_languages(tier))

    if all_failures:
        print("LANGUAGE CONSISTENCY TEST FAILED", file=sys.stderr)
        for f in all_failures:
            print(f"  - {f}", file=sys.stderr)
        sys.exit(1)

    n_langs = len(LANGUAGE_PACKS)
    print(f"OK: language consistency verified for {n_langs} languages across standard and extended tiers")


if __name__ == "__main__":
    main()
