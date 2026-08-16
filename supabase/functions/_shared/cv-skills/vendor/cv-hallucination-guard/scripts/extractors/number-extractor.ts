// cv-hallucination-guard — Number extractor
// Trekker ut tall-claims (beløp, prosent, antall, multiplikatorer) fra tekst.

import type { ExtractedClaim } from "../types.ts";

// ---------------------------------------------------------------------------
// Regex-mønstre
// ---------------------------------------------------------------------------

// Beløp med valuta: "USD 45 mill.", "NOK 4,5 mrd.", "$45M"
const CURRENCY_PATTERN =
  /\b(NOK|USD|EUR|GBP|SEK|DKK|\$|€|£)\s*(\d[\d\s.,]*\d|\d)\s*(mill\.?|millioner?|millions?|mrd\.?|milliarder?|billions?|k|tusen|thousands?|M|B|bn)?\b/gi;

// Prosent: "40 %", "40%", "40 prosent"
const PERCENT_PATTERN = /\b([\d.,]+)\s*(?:%|prosent|percent)\b/gi;

// Multiplikator: "2.5x", "doblet", "2x ARR", "trippel"
const MULTIPLIER_PATTERN = /\b([\d.,]+)\s*x\b/gi;

// Antall mennesker: "27 ansatte", "team på 12", "ledet 50 personer"
const HEADCOUNT_PATTERN =
  /\b(?:team\s+(?:på|of)\s+)?(\d+)(?:\+|\s+\+)?\s*(ansatte|personer|medarbeidere|employees|people|developers|utviklere|salgsmedarbeidere|FTE)/gi;

// Generelle tall som ikke faller i kategorier over (svakere signal)
const RAW_NUMBER_PATTERN = /\b(\d+(?:[\s.,]\d+)*)\s*(år|måneder|years|months)?\b/gi;

// ---------------------------------------------------------------------------
// Hovedfunksjon
// ---------------------------------------------------------------------------

export function extractNumberClaims(text: string): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];

  // Beløp
  for (const match of text.matchAll(CURRENCY_PATTERN)) {
    const [fullMatch, currencyRaw, amountRaw, unitRaw] = match;
    const amount = parseNorwegianNumber(amountRaw);
    if (!Number.isFinite(amount)) continue;
    const unit = normalizeUnit(unitRaw);
    const currency = normalizeCurrency(currencyRaw);
    claims.push({
      type: "number",
      text: fullMatch.trim(),
      position: match.index ?? 0,
      parsed: {
        kind: "currency",
        currency,
        amount,
        unit,
        normalized_value: amount * unitMultiplier(unit),
      },
      is_hard: true,
    });
  }

  // Prosent
  for (const match of text.matchAll(PERCENT_PATTERN)) {
    const [fullMatch, valueRaw] = match;
    const value = parseNorwegianNumber(valueRaw);
    if (!Number.isFinite(value)) continue;
    claims.push({
      type: "number",
      text: fullMatch.trim(),
      position: match.index ?? 0,
      parsed: { kind: "percent", value },
      is_hard: true,
    });
  }

  // Multiplikator
  for (const match of text.matchAll(MULTIPLIER_PATTERN)) {
    const [fullMatch, valueRaw] = match;
    const value = parseNorwegianNumber(valueRaw);
    if (!Number.isFinite(value) || value < 1) continue;
    claims.push({
      type: "number",
      text: fullMatch.trim(),
      position: match.index ?? 0,
      parsed: { kind: "multiplier", value },
      is_hard: true,
    });
  }

  // Headcount
  for (const match of text.matchAll(HEADCOUNT_PATTERN)) {
    const [fullMatch, valueRaw] = match;
    const value = parseInt(valueRaw, 10);
    if (!Number.isFinite(value)) continue;
    claims.push({
      type: "number",
      text: fullMatch.trim(),
      position: match.index ?? 0,
      parsed: { kind: "headcount", value },
      is_hard: true,
    });
  }

  return claims;
}

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

function parseNorwegianNumber(raw: string): number {
  if (!raw) return NaN;
  // Fjern mellomrom (norsk tusenskille). Behold komma som desimaltegn.
  const cleaned = raw.replace(/\s+/g, "").replace(",", ".");
  // Hvis det er flere punktum, behold bare den siste (tusenskille i mange europeiske formater)
  const parts = cleaned.split(".");
  if (parts.length > 2) {
    const decimals = parts.pop();
    return parseFloat(parts.join("") + "." + decimals);
  }
  return parseFloat(cleaned);
}

function normalizeUnit(raw: string | undefined): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().replace(".", "");
  if (["mill", "million", "millioner", "millions", "m"].includes(lower)) return "million";
  if (["mrd", "milliard", "milliarder", "billion", "billions", "b", "bn"].includes(lower)) return "billion";
  if (["k", "tusen", "thousand", "thousands"].includes(lower)) return "thousand";
  return null;
}

function normalizeCurrency(raw: string): string {
  const upper = raw.toUpperCase();
  if (upper === "$") return "USD";
  if (raw === "€") return "EUR";
  if (raw === "£") return "GBP";
  return upper;
}

function unitMultiplier(unit: string | null): number {
  if (unit === "thousand") return 1_000;
  if (unit === "million") return 1_000_000;
  if (unit === "billion") return 1_000_000_000;
  return 1;
}
