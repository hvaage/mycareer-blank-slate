"""Country-to-register mapping for the employer-analysis-eu skill.

Maps ISO Alpha-2 country codes to the primary public registers and finance
sources for that country. Used during entity identification and during the
Financial Stability dimension scoring.

Usage:
    from source_registry import get_sources_for, IN_SCOPE_COUNTRIES

    sources = get_sources_for("DE")
    # -> {"primary_register": "Bundesanzeiger", ...}
"""

from typing import Dict, List

IN_SCOPE_COUNTRIES = {
    "NO", "SE", "DK", "FI", "IS",
    "DE", "AT", "CH",
    "NL", "BE", "LU",
    "FR", "GB",
    "ES", "PT", "IT",
}

COUNTRY_NAMES = {
    "NO": "Norway",
    "SE": "Sweden",
    "DK": "Denmark",
    "FI": "Finland",
    "IS": "Iceland",
    "DE": "Germany",
    "AT": "Austria",
    "CH": "Switzerland",
    "NL": "Netherlands",
    "BE": "Belgium",
    "LU": "Luxembourg",
    "FR": "France",
    "GB": "United Kingdom",
    "ES": "Spain",
    "PT": "Portugal",
    "IT": "Italy",
}

# Per-country source mapping. Each entry lists primary registers and
# supplementary sources useful for the Financial Stability dimension.
COUNTRY_SOURCES: Dict[str, Dict[str, List[str]]] = {
    "NO": {
        "primary_register": ["Brønnøysundregistrene (brreg.no)"],
        "finance": ["Proff.no", "Purehelp.no"],
        "dei_specific": ["Åpenhetsloven reports", "Aktivitets- og redegjørelsesplikten"],
    },
    "SE": {
        "primary_register": ["Bolagsverket"],
        "finance": ["Allabolag", "Ratsit"],
        "dei_specific": [],
    },
    "DK": {
        "primary_register": ["CVR (datacvr.virk.dk)"],
        "finance": ["Virk.dk"],
        "dei_specific": [],
    },
    "FI": {
        "primary_register": ["PRH (Patent and Registration Office)"],
        "finance": ["Asiakastieto"],
        "dei_specific": [],
    },
    "IS": {
        "primary_register": ["Fyrirtækjaskrá (RSK)"],
        "finance": [],
        "dei_specific": [],
    },
    "DE": {
        "primary_register": ["Bundesanzeiger", "Handelsregister"],
        "finance": ["Bundesanzeiger"],
        "dei_specific": [],
    },
    "AT": {
        "primary_register": ["Firmenbuch"],
        "finance": ["WKO"],
        "dei_specific": [],
    },
    "CH": {
        "primary_register": ["Zefix"],
        "finance": ["Moneyhouse"],
        "dei_specific": [],
    },
    "NL": {
        "primary_register": ["KVK (Kamer van Koophandel)"],
        "finance": ["KVK"],
        "dei_specific": [],
    },
    "BE": {
        "primary_register": ["KBO/BCE"],
        "finance": ["KBO/BCE"],
        "dei_specific": [],
    },
    "LU": {
        "primary_register": ["Registre de Commerce et des Sociétés"],
        "finance": [],
        "dei_specific": [],
    },
    "FR": {
        "primary_register": ["Infogreffe", "Pappers"],
        "finance": ["Societe.com", "Pappers"],
        "dei_specific": [],
    },
    "GB": {
        "primary_register": ["Companies House"],
        "finance": ["Companies House", "Endole"],
        "dei_specific": ["UK Gender Pay Gap Service"],
    },
    "ES": {
        "primary_register": ["Registro Mercantil"],
        "finance": ["eInforma"],
        "dei_specific": [],
    },
    "PT": {
        "primary_register": ["Portal Justiça (Citius)"],
        "finance": [],
        "dei_specific": [],
    },
    "IT": {
        "primary_register": ["Registroimprese.it (Camera di Commercio)"],
        "finance": ["Registroimprese.it"],
        "dei_specific": [],
    },
}

GLOBAL_SOURCES = {
    "employee_reviews": ["Glassdoor", "Indeed", "Kununu (DACH)", "Trustpilot"],
    "talent_attraction": ["Great Place to Work", "Top Employer Institute"],
    "leadership_signals": ["LinkedIn"],
    "financial_listed": ["Yahoo Finance"],
    "esg": ["CSRD reporting", "GRI Standards", "SASB Standards"],
    "certifications": [
        "EDGE", "B Corp", "Investors in People",
        "Top Employer", "Great Place to Work certification",
    ],
}


def is_in_scope(country_code: str) -> bool:
    """Return True if the country is in the skill's primary scope."""
    return country_code.upper() in IN_SCOPE_COUNTRIES


def get_country_name(country_code: str) -> str:
    """Return the country name for the ISO Alpha-2 code, or the code itself."""
    return COUNTRY_NAMES.get(country_code.upper(), country_code.upper())


def get_sources_for(country_code: str) -> Dict[str, List[str]]:
    """Return all relevant sources for a given country.

    Combines country-specific and global sources. Returns an empty
    country-specific section if the country is outside scope.
    """
    code = country_code.upper()
    country_specific = COUNTRY_SOURCES.get(code, {
        "primary_register": [],
        "finance": [],
        "dei_specific": [],
    })
    return {
        "country_name": get_country_name(code),
        "in_scope": is_in_scope(code),
        "country_specific": country_specific,
        "global": GLOBAL_SOURCES,
    }


if __name__ == "__main__":
    # Sanity check
    import json
    import sys

    code = sys.argv[1] if len(sys.argv) > 1 else "NO"
    print(json.dumps(get_sources_for(code), indent=2, ensure_ascii=False))
