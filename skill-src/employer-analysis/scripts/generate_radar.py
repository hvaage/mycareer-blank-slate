"""Radar chart generator for the employer-analysis-eu skill.

Generates an SVG radar (spider) chart visualizing scores across the eight
dimensions. Pure Python, no matplotlib dependency, so the SVG can be embedded
directly in the HTML template before weasyprint renders the PDF.

Usage:
    from generate_radar import build_radar_svg

    scores = {
        "Culture and Values": 4.0,
        "Leadership Quality": 3.5,
        "Work Environment": 4.5,
        "Career Development": 3.0,
        "Financial Stability": None,  # insufficient evidence
        "Mission and Purpose": 4.0,
        "Talent Attraction and Retention": 3.5,
        "Diversity and Inclusion": 4.5,
    }
    svg = build_radar_svg(scores, accent_color="#2C5282")
"""

import math
from typing import Dict, Optional

DEFAULT_ACCENT = "#2C5282"
GRID_COLOR = "#CBD5E0"
LABEL_COLOR = "#1A202C"
INSUFFICIENT_COLOR = "#A0AEC0"

# Chart geometry (units: SVG user units)
WIDTH = 520
HEIGHT = 520
CENTER_X = WIDTH / 2
CENTER_Y = HEIGHT / 2
RADIUS = 175
MAX_SCORE = 5.0


def _polar_to_cartesian(angle_rad: float, radius: float) -> tuple:
    """Convert polar coordinates (angle in radians, radius) to SVG (x, y)."""
    x = CENTER_X + radius * math.cos(angle_rad)
    y = CENTER_Y + radius * math.sin(angle_rad)
    return x, y


def _angle_for_index(i: int, total: int) -> float:
    """Return the angle (radians) for spoke i, starting at 12 o'clock and
    proceeding clockwise."""
    return -math.pi / 2 + (2 * math.pi * i / total)


def _wrap_label(label: str, max_width: int = 18) -> list:
    """Wrap a label across two lines for readability if longer than max_width."""
    if len(label) <= max_width:
        return [label]
    words = label.split()
    line1, line2 = [], []
    for w in words:
        if sum(len(x) for x in line1) + len(line1) + len(w) <= max_width:
            line1.append(w)
        else:
            line2.append(w)
    if not line2:
        return [label]
    return [" ".join(line1), " ".join(line2)]


def build_radar_svg(
    scores: Dict[str, Optional[float]],
    accent_color: str = DEFAULT_ACCENT,
) -> str:
    """Build an SVG radar chart from a dictionary of dimension scores.

    Args:
        scores: Mapping from dimension label to score (1.0 - 5.0) or None
                for insufficient evidence. Order is preserved.
        accent_color: Hex color used for the polygon fill and stroke.

    Returns:
        SVG markup as a string.
    """
    labels = list(scores.keys())
    n = len(labels)
    if n < 3:
        raise ValueError("Need at least 3 dimensions for a radar chart")

    parts: list = []
    parts.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {WIDTH} {HEIGHT}" width="100%" '
        f'role="img" aria-label="Radar chart of employer dimensions">'
    )

    # Concentric gridlines at scores 1, 2, 3, 4, 5
    for level in range(1, 6):
        r = RADIUS * (level / MAX_SCORE)
        pts = []
        for i in range(n):
            angle = _angle_for_index(i, n)
            x, y = _polar_to_cartesian(angle, r)
            pts.append(f"{x:.1f},{y:.1f}")
        parts.append(
            f'<polygon points="{" ".join(pts)}" fill="none" '
            f'stroke="{GRID_COLOR}" stroke-width="0.6" />'
        )
        # Numeric scale label on the top spoke
        if level in (1, 2, 3, 4, 5):
            top_x, top_y = _polar_to_cartesian(_angle_for_index(0, n), r)
            parts.append(
                f'<text x="{top_x + 6:.1f}" y="{top_y + 3:.1f}" '
                f'font-size="9" fill="{GRID_COLOR}" '
                f'font-family="sans-serif">{level}</text>'
            )

    # Spokes
    for i in range(n):
        angle = _angle_for_index(i, n)
        x, y = _polar_to_cartesian(angle, RADIUS)
        score = scores[labels[i]]
        stroke = INSUFFICIENT_COLOR if score is None else GRID_COLOR
        dasharray = ' stroke-dasharray="4,3"' if score is None else ""
        parts.append(
            f'<line x1="{CENTER_X}" y1="{CENTER_Y}" '
            f'x2="{x:.1f}" y2="{y:.1f}" stroke="{stroke}"{dasharray} '
            f'stroke-width="0.8" />'
        )

    # Score polygon. Insufficient-evidence dimensions are skipped (the polygon
    # crosses through center for those spokes).
    poly_pts = []
    for i, label in enumerate(labels):
        score = scores[label]
        if score is None:
            # Draw to center to indicate missing data
            poly_pts.append(f"{CENTER_X:.1f},{CENTER_Y:.1f}")
            continue
        r = RADIUS * (score / MAX_SCORE)
        angle = _angle_for_index(i, n)
        x, y = _polar_to_cartesian(angle, r)
        poly_pts.append(f"{x:.1f},{y:.1f}")

    parts.append(
        f'<polygon points="{" ".join(poly_pts)}" '
        f'fill="{accent_color}" fill-opacity="0.25" '
        f'stroke="{accent_color}" stroke-width="1.5" '
        f'stroke-linejoin="round" />'
    )

    # Score dots on top of polygon
    for i, label in enumerate(labels):
        score = scores[label]
        if score is None:
            continue
        r = RADIUS * (score / MAX_SCORE)
        angle = _angle_for_index(i, n)
        x, y = _polar_to_cartesian(angle, r)
        parts.append(
            f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3.5" '
            f'fill="{accent_color}" />'
        )

    # Dimension labels at the perimeter
    label_radius = RADIUS + 28
    for i, label in enumerate(labels):
        angle = _angle_for_index(i, n)
        x, y = _polar_to_cartesian(angle, label_radius)

        # Determine text-anchor based on position
        cos_a = math.cos(angle)
        if cos_a > 0.2:
            anchor = "start"
        elif cos_a < -0.2:
            anchor = "end"
        else:
            anchor = "middle"

        lines = _wrap_label(label, max_width=16)
        line_height = 12
        # Center the wrapped block vertically around y
        y_offset = -((len(lines) - 1) * line_height) / 2
        for li, line in enumerate(lines):
            parts.append(
                f'<text x="{x:.1f}" y="{y + y_offset + li * line_height:.1f}" '
                f'font-size="10" font-family="sans-serif" '
                f'fill="{LABEL_COLOR}" text-anchor="{anchor}">{line}</text>'
            )

    parts.append("</svg>")
    return "\n".join(parts)


if __name__ == "__main__":
    # Self-test
    demo = {
        "Culture and Values": 4.0,
        "Leadership Quality": 3.5,
        "Work Environment": 4.5,
        "Career Development": 3.0,
        "Financial Stability": None,
        "Mission and Purpose": 4.0,
        "Talent Attraction and Retention": 3.5,
        "Diversity and Inclusion": 4.5,
    }
    svg = build_radar_svg(demo)
    with open("/tmp/radar_demo.svg", "w", encoding="utf-8") as f:
        f.write(svg)
    print("Wrote /tmp/radar_demo.svg")
