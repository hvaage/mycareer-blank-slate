// Serveronly: klassifisering av arkivstier mot kontraktens §2.5-inventar.

import { specForPath, type LinkedInFileSpec } from "./contract";
import type { PreflightEntry } from "./preflight.server";

export type ClassifiedEntry = {
  entry: PreflightEntry;
  spec: LinkedInFileSpec;
};

export type ClassificationResult = {
  /** Klasse A og B — får rad i linkedin_import_files. */
  known: ClassifiedEntry[];
  /** Klasse C — leses aldri, kun aggregert teller per årsak. */
  excludedReasonCounts: Record<string, number>;
  excludedFileCount: number;
  unknownPaths: string[];
};

export function classifyEntries(entries: PreflightEntry[]): ClassificationResult {
  const known: ClassifiedEntry[] = [];
  const excludedReasonCounts: Record<string, number> = {};
  const unknownPaths: string[] = [];
  let excludedFileCount = 0;

  for (const entry of entries) {
    const spec = specForPath(entry.archivePath);
    if (!spec) {
      unknownPaths.push(entry.archivePath);
      continue;
    }
    if (spec.fileClass === "C") {
      excludedFileCount += 1;
      const reason = spec.excludedReason ?? "excluded";
      excludedReasonCounts[reason] = (excludedReasonCounts[reason] ?? 0) + 1;
      continue;
    }
    known.push({ entry, spec });
  }

  return { known, excludedReasonCounts, excludedFileCount, unknownPaths };
}
