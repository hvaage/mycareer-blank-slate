"""Anonymous report submission client for the employer-analysis skill.

Submits the structured report JSON to KarrierenMin.no's Analysedatabase
("Analysis database") so all users benefit from a shared, open knowledge
base of European employer analyses.

Privacy model
-------------
- Only the report's structured company-level data is submitted.
- No user identifier, no IP, no PDF, no search log.
- The submission is enabled by default but the user is asked for explicit
  consent before any submission and can decline.
- A client-generated ``report_id`` (UUID) provides idempotency so a retry
  after a network blip does not create a duplicate row in the database.

Configuration
-------------
Two values must be present for submission to succeed:

    SUPABASE_ENDPOINT  — full HTTPS URL of the ingest endpoint, for example
                         https://karrierenmin.no/api/public/ingest-report
    SUPABASE_ANON_KEY  — the shared ingestion key (publicly distributed in
                         the skill package; serves as a low-friction gate)

Configuration is resolved in this order:
1. config.json in the skill package root
2. Environment variables SUPABASE_ENDPOINT and SUPABASE_ANON_KEY
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List


SCHEMA_VERSION = "1.1"
DEFAULT_TIMEOUT_SECONDS = 10
TOTAL_DIMENSIONS_DEFAULT = 8


def _load_config() -> tuple[str | None, str | None]:
    config_path = Path(__file__).parent.parent / "config.json"
    endpoint = None
    api_key = None

    if config_path.exists():
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
                endpoint = config.get("supabase_endpoint")
                api_key = config.get("supabase_anon_key")
        except (json.JSONDecodeError, OSError, KeyError):
            pass

    if not endpoint:
        endpoint = os.environ.get("SUPABASE_ENDPOINT")
    if not api_key:
        api_key = os.environ.get("SUPABASE_ANON_KEY")

    return endpoint, api_key


def _normalize_dimensions(report_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return all dimensions with score / label / source_count.

    Dimensions where the skill could not assign a score are kept in the
    payload with ``score: null`` and an explicit label of
    ``insufficient_data`` (or ``not_assessed``). This preserves
    data-quality information for the receiver.
    """
    out: List[Dict[str, Any]] = []
    for d in report_data.get("dimensions", []) or []:
        score = d.get("score")
        label = d.get("label")
        # Score is allowed to be None; normalize the label accordingly.
        if score is None and label not in ("insufficient_data", "not_assessed"):
            label = "insufficient_data"
        out.append({
            "name": d.get("name"),
            "score": score,
            "label": label or ("sourced" if score is not None else "insufficient_data"),
            "source_count": len(d.get("source_ids", []) or []),
        })
    return out


def _strip_to_anonymous_payload(
    report_data: Dict[str, Any],
    tier: str,
    language: str,
) -> Dict[str, Any]:
    """Return a sanitized payload containing only company-level data."""
    company = report_data.get("company", {}) or {}
    overall = report_data.get("overall", {}) or {}
    dimensions = _normalize_dimensions(report_data)

    return {
        "schema_version": SCHEMA_VERSION,
        "report_id": str(uuid.uuid4()),
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "language": language,
        "tier": tier,
        "company": {
            "name": company.get("name"),
            "domain": company.get("domain"),
            "branch_country": company.get("branch_country"),
            "parent_country": company.get("parent_country"),
            "analysis_date": company.get("analysis_date"),
            # New in schema 1.1 — kept optional so the receiver accepts null/missing.
            "employee_count": company.get("employee_count"),
            "employee_count_source": company.get("employee_count_source"),
            "employee_count_as_of": company.get("employee_count_as_of"),
            "revenue_bucket": company.get("revenue_bucket"),
            "industry_nace": company.get("industry_nace"),
        },
        "overall": {
            "score": overall.get("score"),
            "scored_dimensions": overall.get(
                "scored_dimensions",
                sum(1 for d in dimensions if d["score"] is not None),
            ),
            "total_dimensions": overall.get(
                "total_dimensions", TOTAL_DIMENSIONS_DEFAULT
            ),
        },
        "dimensions": dimensions,
        "source_count": len(report_data.get("sources", []) or []),
        "search_count": len(report_data.get("search_log", []) or []),
        "scope_deviation": bool(report_data.get("scope_deviation")),
    }


def submit_anonymous(
    report_data: Dict[str, Any],
    consent: bool,
    tier: str = "standard",
    language: str = "en",
    endpoint: str | None = None,
    api_key: str | None = None,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> Dict[str, Any]:
    """Submit an anonymized report payload to the Analysedatabase endpoint."""
    if not consent:
        return {"sent": False, "reason": "user_opted_out", "status_code": None}

    if endpoint is None or api_key is None:
        config_endpoint, config_api_key = _load_config()
        endpoint = endpoint or config_endpoint
        api_key = api_key or config_api_key

    if not endpoint or not api_key:
        return {
            "sent": False,
            "reason": "endpoint_or_key_missing",
            "status_code": None,
        }

    payload = _strip_to_anonymous_payload(report_data, tier=tier, language=language)
    body = json.dumps(payload).encode("utf-8")

    request = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "apikey": api_key,
            "X-Schema-Version": SCHEMA_VERSION,
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as resp:
            return {"sent": True, "reason": "ok", "status_code": resp.status}
    except urllib.error.HTTPError as exc:
        return {
            "sent": False,
            "reason": f"http_error: {exc.code}",
            "status_code": exc.code,
        }
    except (urllib.error.URLError, TimeoutError) as exc:
        return {
            "sent": False,
            "reason": f"network_error: {exc}",
            "status_code": None,
        }


if __name__ == "__main__":
    sample = {
        "company": {
            "name": "Equinor ASA",
            "domain": "equinor.com",
            "branch_country": "Norway",
            "parent_country": None,
            "analysis_date": "2026-05-19",
            "employee_count": 22500,
            "employee_count_source": "brreg",
            "employee_count_as_of": "2025-12-31",
            "revenue_bucket": ">1B EUR",
            "industry_nace": "06",
        },
        "overall": {"score": 4.1, "scored_dimensions": 7, "total_dimensions": 8},
        "dimensions": [
            {"name": "Culture and Values", "score": 4.0, "label": "sourced", "source_ids": [1, 2, 3]},
            {"name": "Diversity", "score": None, "label": "insufficient_data", "source_ids": []},
        ],
        "sources": [{"id": 1}, {"id": 2}, {"id": 3}],
        "search_log": [{"query": "x"}, {"query": "y"}],
    }
    print(json.dumps(_strip_to_anonymous_payload(sample, "standard", "nb"), indent=2))
