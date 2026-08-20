// Serveronly: CSV-parsing for LinkedIn-eksport.
// Låst parserregel for Connections.csv: kontrakt §8.5.1.

import { LINKEDIN_LIMITS } from "./contract";
import { decodeUtf8Strict } from "./preflight.server";

export type CsvParseResult =
  | { ok: true; header: string[]; rows: Array<{ rowNumber: number; values: string[] }> }
  | { ok: false; code: string };

/** RFC4180-tolerant splitting; håndterer quotes, CRLF og innebygde linjeskift. */
export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      /* ignorer */
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export const CONNECTIONS_EXPECTED_HEADER = [
  "First Name",
  "Last Name",
  "URL",
  "Email Address",
  "Company",
  "Position",
  "Connected On",
];

/**
 * `connections_csv_preamble_v1`: hopp nøyaktig tre preamblelinjer og valider
 * forventet header på linje fire. Ingen videre søk nedover i filen.
 * Logging skjer aldri her — kun feilkoder returneres.
 */
export function parseConnectionsCsv(text: string): CsvParseResult {
  const all = splitCsv(text);
  if (all.length < 4) return { ok: false, code: "connections_header_not_found" };
  const header = (all[3] ?? []).map((h) => h.trim());
  const expected = CONNECTIONS_EXPECTED_HEADER;
  if (header.length === 0 || header.every((h) => h === "")) {
    return { ok: false, code: "connections_header_not_found" };
  }
  const matches =
    header.length >= expected.length &&
    expected.every((e, i) => header[i]?.toLowerCase() === e.toLowerCase());
  if (!matches) return { ok: false, code: "connections_unexpected_header" };

  const rows = all.slice(4).map((values, idx) => ({ rowNumber: idx + 5, values }));
  if (rows.length > LINKEDIN_LIMITS.maxCsvRows) return { ok: false, code: "row_limit_exceeded" };
  return { ok: true, header, rows };
}

export function parseGenericCsv(text: string): CsvParseResult {
  const all = splitCsv(text);
  if (all.length === 0) return { ok: false, code: "empty_file" };
  const header = (all[0] ?? []).map((h) => h.trim());
  if (header.every((h) => h === "")) return { ok: false, code: "header_not_found" };
  const rows = all.slice(1).map((values, idx) => ({ rowNumber: idx + 2, values }));
  if (rows.length > LINKEDIN_LIMITS.maxCsvRows) return { ok: false, code: "row_limit_exceeded" };
  return { ok: true, header, rows };
}

export function parseCsvFile(archivePath: string, bytes: Uint8Array): CsvParseResult {
  const decoded = decodeUtf8Strict(bytes);
  if (!decoded.ok) return { ok: false, code: decoded.code };
  return /^Connections\.csv$/i.test(archivePath)
    ? parseConnectionsCsv(decoded.text)
    : parseGenericCsv(decoded.text);
}

/** §8.4 — flagges ved import, rådata endres ikke. */
export function isFormulaInjectionCandidate(value: string): boolean {
  return /^[=+\-@\t\r]/.test(value);
}

export function rowToObject(header: string[], values: string[]) {
  const out: Record<string, string> = {};
  header.forEach((key, i) => {
    if (!key) return;
    const raw = values[i] ?? "";
    out[key] = raw.length > LINKEDIN_LIMITS.maxFieldBytes ? raw.slice(0, LINKEDIN_LIMITS.maxFieldBytes) : raw;
  });
  return out;
}
