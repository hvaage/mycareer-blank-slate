// Serveronly: kanonisk kontrakt for LinkedIn-avstemming (Fase 3).
//
// Avstemmingen er deterministisk: ingen KI, ingen nettverkskall, ingen skriving
// til produktdata. Alle versjoner er eksplisitte slik at et forslag kan spores
// tilbake til nøyaktig hvilken logikk som produserte det.

import { sha256Hex } from "../preflight.server";

export const RECONCILIATION_VERSION = "linkedin_reconciliation_v1";
export const RECONCILIATION_NORMALIZATION_VERSION = "linkedin_identity_v1";
/**
 * Motorrevisjon: inngår i inputsignaturen slik at kjøringer laget før
 * trådmodellen ikke gjenbrukes i det uendelige. Bumpes kun når motorens
 * utfall faktisk endres.
 */
export const RECONCILIATION_ENGINE_REVISION = "threads_v1";

export const RECONCILIATION_DOMAINS = [
  "profile",
  "career",
  "network",
  "jobs",
  "learning",
  "content",
  "recommendations",
  "endorsements",
] as const;
export type ReconciliationDomain = (typeof RECONCILIATION_DOMAINS)[number];

export const PROPOSAL_KINDS = [
  "create",
  "possible_duplicate",
  "possible_update",
  "conflict",
  "keep_existing",
  "deferred",
  "not_actionable_in_phase_3",
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const MATCH_METHODS = [
  "none",
  "exact_key",
  "normalized_key",
  "fuzzy_name_period",
  "url_match",
  "email_match",
  "field_diff",
] as const;
export type MatchMethod = (typeof MATCH_METHODS)[number];

export const SKIP_REASONS = [
  "skipped_no_selected_purpose",
  "skipped_no_source_records",
  "skipped_import_purged",
  "excluded_by_product_contract_v1_1",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** Grenser for hvor mye kildeinnhold som fryses i et forslag. */
export const SNAPSHOT_LIMITS = {
  maxTextLength: 600,
  maxFields: 24,
};

export type ProposalDraft = {
  domain: ReconciliationDomain;
  kind: ProposalKind;
  dedupeKey: string;
  confidence: number;
  matchMethod: MatchMethod;
  sourceClassification: "A" | "B";
  sourceSnapshot: Record<string, unknown>;
  targetSnapshot: Record<string, unknown> | null;
  proposedPayload: Record<string, unknown> | null;
  comparison: Record<string, unknown>;
  reasonCodes: string[];
  reviewMessage: string;
  sources: Array<{
    stagingRecordId: string;
    role: "primary" | "supporting" | "third_party_signal" | "third_party_recommendation";
    reference: Record<string, unknown>;
  }>;
};

/** NFKC, små bokstaver, kollapset whitespace, uten tegnsetting i endene. */
export function normKey(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim();
}

const ORG_NOISE = new Set([
  "as", "asa", "a/s", "ab", "ltd", "limited", "inc", "llc", "gmbh", "plc",
  "norway", "norge", "nordics", "group", "the",
]);

/** Kanonisk organisasjonsnøkkel: selskapsformer og geografiske suffikser fjernes. */
export function orgKey(value: string | null | undefined): string {
  const base = normKey(value);
  if (!base) return "";
  return base
    .split(" ")
    .filter((t) => !ORG_NOISE.has(t.replace(/[.,]/g, "")))
    .join(" ")
    .trim();
}

const TITLE_SYNONYMS: Record<string, string> = {
  "chief executive officer": "ceo",
  "administrerende direktor": "ceo",
  "adm. dir": "ceo",
  "chief commercial officer": "cco",
  "chief operating officer": "coo",
  "chief technology officer": "cto",
  "chief financial officer": "cfo",
  "vice president": "vp",
  "senior vice president": "svp",
  "daglig leder": "ceo",
  "landssjef": "country manager",
};

/** Kanonisk stillingsnøkkel med kjente norske/engelske synonymer. */
export function titleKey(value: string | null | undefined): string {
  let base = normKey(value).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  base = base.replace(/\bo\b/g, "o");
  for (const [long, short] of Object.entries(TITLE_SYNONYMS)) {
    if (base === long || base.startsWith(`${long} `) || base.endsWith(` ${long}`)) {
      base = base.replace(long, short);
    }
  }
  return base.trim();
}

/** Token-Jaccard, brukt kun til å skille «sannsynlig samme» fra «ulik». */
export function tokenSimilarity(a: string, b: string): number {
  const sa = new Set(a.split(" ").filter(Boolean));
  const sb = new Set(b.split(" ").filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const t of sa) if (sb.has(t)) shared += 1;
  return shared / (sa.size + sb.size - shared);
}

/** Sammenlignbar YYYY-MM-representasjon, eller null. */
export function monthKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4})(?:-(\d{2}))?/.exec(value.trim());
  if (!m) return null;
  return `${m[1]}-${m[2] ?? "01"}`;
}

/** Overlapper to perioder (åpne slutt-datoer regnes som pågående)? */
export function periodsOverlap(
  aStart: string | null,
  aEnd: string | null,
  bStart: string | null,
  bEnd: string | null,
): boolean {
  const as = monthKey(aStart) ?? "0000-01";
  const ae = monthKey(aEnd) ?? "9999-12";
  const bs = monthKey(bStart) ?? "0000-01";
  const be = monthKey(bEnd) ?? "9999-12";
  return as <= be && bs <= ae;
}

/** Kutter og begrenser tekst før den fryses i et snapshot. */
export function snapshotText(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!v) return null;
  return v.length > SNAPSHOT_LIMITS.maxTextLength
    ? `${v.slice(0, SNAPSHOT_LIMITS.maxTextLength)}…`
    : v;
}

export async function hashSnapshot(value: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(canonicalize(value)));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value ?? null;
}

/**
 * Inputsignatur for idempotens: samme kildegrunnlag + samme målgrunnlag +
 * samme motorversjon gir samme signatur, og dermed ingen ny kjøring.
 */
export async function computeInputSignature(input: {
  userId: string;
  importId: string;
  purpose: string;
  sourceIdentityHashes: string[];
  targetSignature: string;
}): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      v: RECONCILIATION_VERSION,
      n: RECONCILIATION_NORMALIZATION_VERSION,
      e: RECONCILIATION_ENGINE_REVISION,
      user_id: input.userId,
      import_id: input.importId,
      purpose: input.purpose,
      sources: [...input.sourceIdentityHashes].sort(),
      target: input.targetSignature,
    }),
  );
}
