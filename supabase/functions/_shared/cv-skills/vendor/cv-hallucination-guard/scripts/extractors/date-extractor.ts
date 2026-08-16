// cv-hallucination-guard — Date extractor
// Trekker ut dato- og varighets-claims fra tekst.

import type { ExtractedClaim } from "../types.ts";

// Tidsperiode: "2019–2024", "2019-2024", "2019 til 2024"
const DATE_RANGE_PATTERN =
  /\b(\d{4})\s*[–\-]\s*(\d{4}|nå|present|now)\b/gi;

// Enkelt år: "2019", "siden 2015"
const SINGLE_YEAR_PATTERN = /\b(?:siden|fra|since|from|i)\s+(\d{4})\b/gi;

// Måned år: "jan. 2024", "January 2024", "jun. 2019"
const MONTH_YEAR_PATTERN =
  /\b(jan|feb|mar|apr|mai|may|jun|jul|aug|sep|okt|oct|nov|des|dec)\.?\s+(\d{4})\b/gi;

// Varighet: "5 år", "i løpet av 5 år", "over 3 år", "3 years"
const DURATION_PATTERN =
  /\b(?:i\s+løpet\s+av\s+|over\s+|in\s+|during\s+)?(\d+)\s+(år|år\.?|years?|måneder?|months?)\b/gi;

// Kvartal: "Q3 2023", "3. kvartal 2023"
const QUARTER_PATTERN = /\bQ([1-4])\s+(\d{4})\b/gi;

export function extractDateClaims(text: string): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];

  // Tidsperioder
  for (const match of text.matchAll(DATE_RANGE_PATTERN)) {
    const [fullMatch, startYearRaw, endYearRaw] = match;
    const startYear = parseInt(startYearRaw, 10);
    const endYear = ["nå", "present", "now"].includes(endYearRaw.toLowerCase())
      ? null
      : parseInt(endYearRaw, 10);
    claims.push({
      type: "date",
      text: fullMatch.trim(),
      position: match.index ?? 0,
      parsed: {
        kind: "date_range",
        start_year: startYear,
        end_year: endYear,
        is_current: endYear === null,
      },
      is_hard: true,
    });
  }

  // Måned-år
  for (const match of text.matchAll(MONTH_YEAR_PATTERN)) {
    const [fullMatch, monthRaw, yearRaw] = match;
    const monthNum = monthToNumber(monthRaw);
    const year = parseInt(yearRaw, 10);
    if (!Number.isFinite(year) || !monthNum) continue;
    claims.push({
      type: "date",
      text: fullMatch.trim(),
      position: match.index ?? 0,
      parsed: {
        kind: "month_year",
        year,
        month: monthNum,
      },
      is_hard: true,
    });
  }

  // Varighet
  for (const match of text.matchAll(DURATION_PATTERN)) {
    const [fullMatch, valueRaw, unitRaw] = match;
    const value = parseInt(valueRaw, 10);
    if (!Number.isFinite(value)) continue;
    const unit = unitRaw.toLowerCase().startsWith("å") || unitRaw.toLowerCase().startsWith("y")
      ? "years"
      : "months";
    claims.push({
      type: "date",
      text: fullMatch.trim(),
      position: match.index ?? 0,
      parsed: { kind: "duration", value, unit },
      is_hard: true,
    });
  }

  // Kvartal
  for (const match of text.matchAll(QUARTER_PATTERN)) {
    const [fullMatch, qRaw, yearRaw] = match;
    const quarter = parseInt(qRaw, 10);
    const year = parseInt(yearRaw, 10);
    claims.push({
      type: "date",
      text: fullMatch.trim(),
      position: match.index ?? 0,
      parsed: { kind: "quarter", quarter, year },
      is_hard: true,
    });
  }

  // Enkelt år (svakere signal — kun når preposisjon foran)
  for (const match of text.matchAll(SINGLE_YEAR_PATTERN)) {
    const [fullMatch, yearRaw] = match;
    const year = parseInt(yearRaw, 10);
    if (!Number.isFinite(year) || year < 1900 || year > 2100) continue;
    claims.push({
      type: "date",
      text: fullMatch.trim(),
      position: match.index ?? 0,
      parsed: { kind: "single_year", year },
      is_hard: true,
    });
  }

  return claims;
}

function monthToNumber(raw: string): number | null {
  const map: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, mai: 5, may: 5,
    jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10,
    nov: 11, des: 12, dec: 12,
  };
  return map[raw.toLowerCase()] ?? null;
}
