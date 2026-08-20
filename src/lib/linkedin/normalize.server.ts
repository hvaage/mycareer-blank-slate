// Serveronly: normalisering og identitetshash for LinkedIn-staging.

import { LINKEDIN_IDENTITY_VERSION, type LinkedInPurpose } from "./contract";
import { sha256Hex } from "./preflight.server";

/** NFKC + whitespace-trim. Tom streng blir null. */
export function normalizeText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  return v.length === 0 ? null : v;
}

export type IsoDate = { value: string; precision: "year" | "month" | "day" } | null;

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** Kontrollert datoparsing med eksplisitt presisjon. Aldri gjetting. */
export function parseLinkedInDate(raw: string | null | undefined): IsoDate {
  const v = normalizeText(raw);
  if (!v) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return { value: `${m[1]}-${m[2]}-${m[3]}`, precision: "day" };
  m = /^(\d{4})-(\d{2})$/.exec(v);
  if (m) return { value: `${m[1]}-${m[2]}`, precision: "month" };
  m = /^(\d{4})$/.exec(v);
  if (m) return { value: m[1]!, precision: "year" };
  // "Jan 2015" / "15 Jan 2015"
  m = /^(?:(\d{1,2}) )?([A-Za-z]{3})[a-z]* (\d{4})$/.exec(v);
  if (m) {
    const mm = MONTHS[m[2]!.toLowerCase()];
    if (!mm) return null;
    if (m[1]) return { value: `${m[3]}-${mm}-${m[1]!.padStart(2, "0")}`, precision: "day" };
    return { value: `${m[3]}-${mm}`, precision: "month" };
  }
  return null;
}

/**
 * SHA-256 over kanonisk serialisert, versjonert struktur.
 * `purpose` inngår, så samme kildeinnhold for to formål gir to distinkte rader.
 * Radnummer inngår aldri.
 */
export async function computeSourceIdentityHash(input: {
  userId: string;
  purpose: LinkedInPurpose;
  sourceFile: string;
  recordKind: string;
  fields: Record<string, string | null>;
}): Promise<string> {
  const sortedFields: Record<string, string | null> = {};
  for (const key of Object.keys(input.fields).sort()) {
    sortedFields[key] = normalizeText(input.fields[key] ?? null);
  }
  const canonical = JSON.stringify({
    v: LINKEDIN_IDENTITY_VERSION,
    user_id: input.userId,
    purpose: input.purpose,
    source_file: input.sourceFile,
    record_kind: input.recordKind,
    fields: sortedFields,
  });
  return sha256Hex(canonical);
}
