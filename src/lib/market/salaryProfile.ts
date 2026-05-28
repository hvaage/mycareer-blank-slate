// ============================================================
// Salary profile helpers (SSB 11420/11421)
// ============================================================

import type { DataSource } from "@/lib/supabase";

export const SALARY_PROFILE_SOURCES: DataSource[] = [
  {
    provider: "SSB",
    name: "SSB tabell 11420",
    title: "SSB tabell 11420",
    description:
      "Månedslønn etter utdanningsnivå, næring, sektor, kjønn og arbeidstid.",
    url: "https://www.ssb.no/statbank/table/11420",
    source_url: "https://www.ssb.no/statbank/table/11420",
  } as DataSource,
  {
    provider: "SSB",
    name: "SSB tabell 11421",
    title: "SSB tabell 11421",
    description:
      "Månedslønn etter alder, næring, sektor, kjønn og arbeidstid.",
    url: "https://www.ssb.no/statbank/table/11421",
    source_url: "https://www.ssb.no/statbank/table/11421",
  } as DataSource,
];

/**
 * Robust normalisering for bransjenavn / slug-sammenligning.
 * Eksempel: "Helse og omsorg", "helse-og-omsorg", "helse_omsorg" → "helseomsorg".
 */
export function normalizeIndustryName(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toString()
    .toLowerCase()
    .trim()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/&/g, " ")
    // Fjern "og" og "and" som separate ord
    .replace(/\b(og|and)\b/g, " ")
    // Fjern alle mellomrom, bindestrek, underscore, slash, komma
    .replace(/[\s\-_/,]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function industryNamesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeIndustryName(a);
  const nb = normalizeIndustryName(b);
  if (!na || !nb) return false;
  return na === nb;
}

export type SalaryIndustrySource = "filter" | "fallback" | "none";

export type SalaryIndustryResolution = {
  slug: string | null;
  name: string | null;
  source: SalaryIndustrySource;
};

type KnownIndustry = { slug?: string | null; name?: string | null } | null | undefined;

type PayloadIndustries = {
  primary_industry?: { slug?: string | null; name?: string | null } | null;
  matches?: Array<{ slug?: string | null; name?: string | null }> | null;
  national_signals?: Array<{ slug?: string | null; name?: string | null }> | null;
} | null | undefined;

type PayloadSummary = {
  primary_industry_slug?: string | null;
  primary_industry_name?: string | null;
  filter_industry_name?: string | null;
} | null | undefined;

/**
 * Bestemmer hvilken næringskode lønnsprofilen skal hentes for, og hva
 * den skal vises som i UI.
 *
 * Prioritet:
 *   1. filterSlug (autoritativ — hvis satt, vinner alltid)
 *   2. payload.summary.primary_industry_slug
 *   3. payload.industries.primary_industry.slug
 *   4. payload.industries.matches[0].slug
 *   5. payload.industries.national_signals[0].slug
 *   6. ellers → source: "none"
 *
 * Hvis filterSlug finnes, returnerer vi alltid source: "filter" — selv om
 * vi ikke klarer å løse opp et vakkert visningsnavn. Slug sendes alltid
 * som filter_industry_slug til RPC; vi konstruerer aldri slug fra navn
 * uten en trygg match mot knownIndustries.
 */
export function resolveSalaryIndustry(input: {
  filterSlug?: string | null;
  filterName?: string | null;
  payload?: {
    summary?: PayloadSummary;
    industries?: PayloadIndustries;
    industry_trends?: { items?: Array<{ slug?: string | null; name?: string | null }> | null } | null;
  } | null;
  knownIndustries?: ReadonlyArray<KnownIndustry> | null;
}): SalaryIndustryResolution {
  const { filterSlug, filterName, payload, knownIndustries } = input;

  // 1) Aktivt bransjefilter er autoritativt.
  if (filterSlug && filterSlug.trim().length > 0) {
    const known = (knownIndustries ?? []).find(
      (k) => k && typeof k.slug === "string" && k.slug === filterSlug,
    );
    const fromTrends = (payload?.industry_trends?.items ?? []).find(
      (it) => it && it.slug === filterSlug,
    );
    const fromMatches = (payload?.industries?.matches ?? []).find(
      (m) => m && m.slug === filterSlug,
    );
    const fromSummary =
      payload?.summary?.filter_industry_name ??
      payload?.summary?.primary_industry_name ??
      null;
    const name =
      (known?.name && known.name.trim()) ||
      (fromMatches?.name && fromMatches.name.trim()) ||
      (fromTrends?.name && fromTrends.name.trim()) ||
      (filterName && filterName.trim()) ||
      (fromSummary && fromSummary.trim()) ||
      null;
    return { slug: filterSlug, name: name ?? null, source: "filter" };
  }

  // 2..5) Defensiv fallback fra payload.
  const candidates: Array<{ slug?: string | null; name?: string | null }> = [];

  const summarySlug = payload?.summary?.primary_industry_slug ?? null;
  if (summarySlug) {
    candidates.push({
      slug: summarySlug,
      name: payload?.summary?.primary_industry_name ?? null,
    });
  }
  const primary = payload?.industries?.primary_industry ?? null;
  if (primary && primary.slug) candidates.push(primary);

  for (const m of payload?.industries?.matches ?? []) {
    if (m && m.slug) {
      candidates.push(m);
      break;
    }
  }
  for (const s of payload?.industries?.national_signals ?? []) {
    if (s && typeof s.slug === "string" && s.slug.length > 0) {
      candidates.push(s);
      break;
    }
  }
  for (const it of payload?.industry_trends?.items ?? []) {
    if (it && it.slug) {
      candidates.push(it);
      break;
    }
  }

  for (const c of candidates) {
    if (c.slug && c.slug.trim().length > 0) {
      const known = (knownIndustries ?? []).find(
        (k) => k && k.slug === c.slug,
      );
      const name =
        (known?.name && known.name.trim()) ||
        (c.name && c.name.trim()) ||
        null;
      return { slug: c.slug, name, source: "fallback" };
    }
  }

  return { slug: null, name: null, source: "none" };
}
