import type { EmployerNeedItem } from "@/lib/market";

// ============================================================
// Shared helpers for MarketOverview / CareerExplorer
// ============================================================

export function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Generic NHO indicator that should never appear as a clickable need card
 * (or in related lists). It is an aggregate, not an actionable signal.
 */
export function isUnmet(n: EmployerNeedItem): boolean {
  if (n.type === "nho_unmet_need") return true;
  return norm(n.label) === "udekket kompetansebehov";
}

export function needScore(n: EmployerNeedItem): number {
  return Number(n.value ?? n.high_intensity_value ?? 0);
}

/**
 * Region match that supports both kommune and fylke:
 *  - exact match
 *  - if filter is a 2-digit fylke code: item starts with `K-${filter}`
 */
export function matchesRegion(
  filterRegionCode: string | null | undefined,
  itemRegionCode: string | null | undefined,
): boolean {
  if (!filterRegionCode || !itemRegionCode) return false;
  if (filterRegionCode === itemRegionCode) return true;
  if (filterRegionCode.length === 2 && itemRegionCode.startsWith(`K-${filterRegionCode}`)) {
    return true;
  }
  return false;
}

/**
 * Dedup employer needs on normalized type + label. Keeps the entry that
 *  - best matches the active region/industry filter, and (tiebreaker)
 *  - has the highest value/high_intensity_value.
 * Filters out generic "Udekket kompetansebehov" indicators.
 */
export function dedupeNeeds(
  needs: EmployerNeedItem[],
  filters: { regionCode: string | null; industrySlug: string | null },
): EmployerNeedItem[] {
  const matchesFilter = (x: EmployerNeedItem) =>
    (filters.industrySlug && x.industry_slug === filters.industrySlug ? 1 : 0) +
    (filters.regionCode && matchesRegion(filters.regionCode, x.region_code) ? 1 : 0);

  const byKey = new Map<string, EmployerNeedItem>();
  for (const n of needs) {
    if (isUnmet(n)) continue;
    const key = `${n.type ?? ""}::${norm(n.label)}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, n);
      continue;
    }
    const a = matchesFilter(n);
    const b = matchesFilter(prev);
    if (a > b || (a === b && needScore(n) > needScore(prev))) {
      byKey.set(key, n);
    }
  }
  return Array.from(byKey.values());
}

export type SignalKind = "competence_field" | "education_level" | "other";

/**
 * Use actual payload type values — not substring guessing — to classify
 * the signal. Anything we don't recognize is treated as a generic
 * "behovssignal".
 */
export function signalKind(n: EmployerNeedItem | null | undefined): SignalKind {
  if (!n) return "other";
  if (n.type === "nho_competence_field_need") return "competence_field";
  if (n.type === "nho_education_level_need") return "education_level";
  return "other";
}

/** Identity by type + normalized label (so React re-render replaces work). */
export function matchesNeedSignal(
  a: EmployerNeedItem | null | undefined,
  b: EmployerNeedItem | null | undefined,
): boolean {
  if (!a || !b) return false;
  return (a.type ?? "") === (b.type ?? "") && norm(a.label) === norm(b.label);
}

// ============================================================
// Tautology guards: don't echo the filter back as a "finding"
// ============================================================

/** Normalize a label for comparison: strip technical " - suffix", lowercase, collapse spaces. */
export function cleanLabel(s: string | null | undefined): string {
  if (!s) return "";
  const dash = s.indexOf(" - ");
  const base = dash >= 0 ? s.slice(0, dash) : s;
  return base.trim().toLowerCase().replace(/\s+/g, " ");
}

type HasRegion = {
  region_code?: string | null;
  region_label?: string | null;
  regional_signal?: { region_code?: string | null; region_label?: string | null } | null;
};

/**
 * True if the item just echoes the active region filter.
 * For a fylke filter (e.g. "50"), kommune items under that fylke are NOT
 * considered tautological — only an exact code match or exact label match.
 */
export function isSelectedRegionResult(
  item: HasRegion,
  selectedRegionCode: string | null | undefined,
  selectedRegionLabel: string | null | undefined,
): boolean {
  if (!selectedRegionCode && !selectedRegionLabel) return false;
  const codes = [item.region_code, item.regional_signal?.region_code].filter(
    Boolean,
  ) as string[];
  const labels = [item.region_label, item.regional_signal?.region_label].filter(
    Boolean,
  ) as string[];
  if (selectedRegionCode && codes.some((c) => c === selectedRegionCode)) return true;
  if (selectedRegionLabel) {
    const sel = cleanLabel(selectedRegionLabel);
    if (sel && labels.some((l) => cleanLabel(l) === sel)) return true;
  }
  return false;
}

export function isSelectedIndustry(
  item: { slug?: string | null; name?: string | null },
  selectedSlug: string | null | undefined,
  selectedName?: string | null,
): boolean {
  if (selectedSlug && item.slug && item.slug === selectedSlug) return true;
  if (selectedName && item.name && cleanLabel(item.name) === cleanLabel(selectedName))
    return true;
  return false;
}

export function isSelectedOccupation(
  item: { occupation_uri?: string | null; title?: string | null },
  selectedUri: string | null | undefined,
  selectedTitle: string | null | undefined,
): boolean {
  if (selectedUri && item.occupation_uri && item.occupation_uri === selectedUri)
    return true;
  if (selectedTitle && item.title && cleanLabel(item.title) === cleanLabel(selectedTitle))
    return true;
  return false;
}

