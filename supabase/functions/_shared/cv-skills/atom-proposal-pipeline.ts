// Fase 3B: normalisering av parsekandidater -> atomforslag.
//
// Ren logikk uten database og nettverk, slik at hele kjeden kan testes.
//
// Kanonisk inputkilde er public.cv_parse_candidates knyttet til en cv_imports-rad.
// Fritekst fra klienten er ikke en gyldig kilde og finnes ikke i denne modulen.
//
// Ingenting her skriver til career_atoms. Utfallet er alltid forslag.

import {
  validateNormalizationBatch,
  buildSemanticKey,
} from "./vendor/cv-atom-language-no/scripts/normalizer.ts";
import type {
  NormalizationBatch,
  NormalizationProposal,
} from "./vendor/cv-atom-language-no/scripts/types.ts";

/** Kandidatrad slik pipelinen leser den. Teksten kommer alltid fra databasen. */
export type CandidateInput = {
  id: string;
  local_ref: string;
  suggested_atom_type: string;
  content_no: string | null;
  content_en: string | null;
  source_quote: string | null;
  structured_data: unknown;
  status: string;
  promoted_atom_id: string | null;
};

export type Segment = {
  id: string;
  text: string;
  candidate: CandidateInput;
};

/**
 * Eksplisitt svarkontrakt. Vendorprompten beskriver reglene, men ikke feltnavnene.
 * Denne teksten legges til systemprompten slik at svaret alltid kan valideres.
 * Versjonen inngår i prompt_version-sporet som `+out<versjon>`.
 */
export const OUTPUT_CONTRACT_VERSION = "1";
export const NORMALIZATION_OUTPUT_CONTRACT_NO = `Svar med ett JSON-objekt, uten markdown:
{
  "schema_version": "1.0",
  "language": "no",
  "source_type": "<kopier fra input>",
  "source_id": "<kopier fra input>",
  "source_hash": "<kopier fra input>",
  "warnings": [],
  "proposals": [
    {
      "proposal_id": "<unik streng>",
      "source": { "segment_id": "<eksakt id fra input>", "source_text": "<eksakt tekst fra input>" },
      "normalized_no": "<normalisert norsk tekst>",
      "semantic_key": "<kort nøkkel>",
      "concepts": [],
      "suggested_atom_type": "role|achievement|metric|context|tool|education|skill|domain|language|certification|project|volunteer|summary_fragment",
      "explicit_facts": [],
      "unsupported_implications": [],
      "confidence": 0.0,
      "review_state": "ready_for_atom|needs_review|reject",
      "rationale": "<kort begrunnelse>",
      "clarification_question": null
    }
  ]
}
Lag minst ett forslag per segment. Alle feltene over er obligatoriske.`;

/** Typene som kan belegges direkte. Øvrige blir forslag om evidens, ikke atomer. */
const DIRECT_TYPES = new Set([
  "role",
  "achievement",
  "metric",
  "education",
  "certification",
  "project",
  "volunteer",
  "language",
]);

const KNOWN_TYPES = new Set([
  ...DIRECT_TYPES,
  "skill",
  "domain",
  "tool",
  "context",
  "summary_fragment",
]);

export function candidateText(c: CandidateInput): string {
  const sd = (c.structured_data ?? {}) as Record<string, unknown>;
  const parts = [
    c.content_no,
    c.source_quote,
    typeof sd["title"] === "string" ? (sd["title"] as string) : null,
    typeof sd["employer"] === "string" ? (sd["employer"] as string) : null,
    typeof sd["what"] === "string" ? (sd["what"] as string) : null,
    typeof sd["name"] === "string" ? (sd["name"] as string) : null,
  ].filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  const seen = new Set<string>();
  const unique = parts.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
  return unique.join(" — ").slice(0, 2000);
}

/** Stabil sortering: local_ref, deretter id. Uavhengig av databasens radrekkefølge. */
export function buildSegments(candidates: CandidateInput[]): Segment[] {
  return [...candidates]
    .sort((a, b) =>
      a.local_ref === b.local_ref
        ? a.id.localeCompare(b.id)
        : a.local_ref.localeCompare(b.local_ref, "nb-NO"),
    )
    .map((c) => ({ id: c.id, text: candidateText(c), candidate: c }))
    .filter((s) => s.text.trim().length > 0);
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Kanonisk normalisering av kildetekst før hashing. */
export function canonicalizeSourceText(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/**
 * source_hash representerer KUN kanonisk kildeinnhold for én kandidat.
 * Ingen id-er, ingen importreferanse, ingen versjonsnummer.
 * To kandidater med identisk tekst får derfor samme source_hash, men er
 * fortsatt to sporbare forslag fordi source_record_id skiller dem.
 */
export function computeSourceHash(text: string): Promise<string> {
  return sha256Hex(`cv-source-v1\n${canonicalizeSourceText(text)}`);
}

/** Hash per segment, brukt som per-forslag source_hash. */
export async function computeSegmentHashes(segments: Segment[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const s of segments) out.set(s.id, await computeSourceHash(s.text));
  return out;
}

/**
 * Batchsignatur = kildesettet + prompt- og normalizerversjon.
 * Brukes kun til batch-idempotens, aldri som forslagets source_hash.
 */
export async function computeInputSignature(
  cvImportId: string,
  segments: Segment[],
  promptVersion: string,
  normalizerVersion: string,
): Promise<string> {
  const hashes = await computeSegmentHashes(segments);
  const canonical = JSON.stringify({
    v: 2,
    cv_import_id: cvImportId,
    prompt_version: promptVersion,
    normalizer_version: normalizerVersion,
    segments: segments.map((s) => ({ id: s.id, h: hashes.get(s.id) })),
  });
  return sha256Hex(canonical);
}

export type ParseOutcome =
  | { ok: true; batch: NormalizationBatch }
  | { ok: false; errors: string[] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Runtime-validering av modellsvaret. Ingen tillit til formen. */
export function parseNormalizationOutput(text: string | null): ParseOutcome {
  if (!text || !text.trim()) return { ok: false, errors: ["tomt svar"] };
  let raw: unknown;
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return { ok: false, errors: ["svaret er ikke gyldig JSON"] };
  }
  if (!isObject(raw)) return { ok: false, errors: ["svaret er ikke et objekt"] };
  if (!Array.isArray(raw["proposals"])) return { ok: false, errors: ["proposals mangler"] };

  const errors: string[] = [];
  const proposals: NormalizationProposal[] = [];
  for (const [i, item] of (raw["proposals"] as unknown[]).entries()) {
    if (!isObject(item)) {
      errors.push(`forslag ${i}: ikke et objekt`);
      continue;
    }
    const source = item["source"];
    if (!isObject(source)) {
      errors.push(`forslag ${i}: source mangler`);
      continue;
    }
    const segmentId = str(source["segment_id"]);
    const sourceText = str(source["source_text"]);
    const normalized = str(item["normalized_no"]);
    const proposalId = str(item["proposal_id"]);
    const confidence = typeof item["confidence"] === "number" ? item["confidence"] : null;
    const reviewState = str(item["review_state"]);
    if (!segmentId || !sourceText || !normalized || !proposalId || confidence === null) {
      errors.push(`forslag ${i}: obligatoriske felt mangler`);
      continue;
    }
    if (!["ready_for_atom", "needs_review", "reject"].includes(reviewState ?? "")) {
      errors.push(`forslag ${i}: ukjent review_state`);
      continue;
    }
    const suggested = str(item["suggested_atom_type"]);
    proposals.push({
      proposal_id: proposalId,
      source: {
        segment_id: segmentId,
        source_text: sourceText,
        start_offset: typeof source["start_offset"] === "number" ? source["start_offset"] : null,
        end_offset: typeof source["end_offset"] === "number" ? source["end_offset"] : null,
      },
      normalized_no: normalized,
      semantic_key: str(item["semantic_key"])?.trim() || buildSemanticKey(normalized),
      concepts: Array.isArray(item["concepts"]) ? (item["concepts"] as never[]) : [],
      suggested_atom_type:
        suggested && KNOWN_TYPES.has(suggested)
          ? (suggested as NormalizationProposal["suggested_atom_type"])
          : null,
      explicit_facts: Array.isArray(item["explicit_facts"])
        ? (item["explicit_facts"] as unknown[]).filter((f): f is string => typeof f === "string")
        : [],
      unsupported_implications: Array.isArray(item["unsupported_implications"])
        ? (item["unsupported_implications"] as unknown[]).filter(
            (f): f is string => typeof f === "string",
          )
        : [],
      confidence,
      review_state: reviewState as NormalizationProposal["review_state"],
      rationale: str(item["rationale"]) ?? "",
      clarification_question: str(item["clarification_question"]),
    });
  }

  if (proposals.length === 0) {
    errors.push("ingen brukbare forslag i svaret");
    return { ok: false, errors };
  }

  const batch: NormalizationBatch = {
    schema_version: "1.0",
    language: "no",
    source_type: str(raw["source_type"]) ?? "cv_parse_candidates",
    source_id: str(raw["source_id"]) ?? "",
    source_hash: str(raw["source_hash"]) ?? "",
    proposals,
    warnings: Array.isArray(raw["warnings"])
      ? (raw["warnings"] as unknown[]).filter((w): w is string => typeof w === "string")
      : [],
  };
  return { ok: true, batch };
}

export type ProposalRow = {
  proposal_action: "create_atom" | "suggest_evidence";
  target_atom_type: "career_atom";
  source_type: string;
  source_table: "cv_parse_candidates";
  source_record_id: string;
  source_id: string;
  source_import_id: string;
  source_hash: string;
  normalizer_version: string;
  prompt_version: string;
  model_run_id: string;
  confidence: number;
  inferred: boolean;
  rationale: string;
  explanation: string | null;
  proposal_payload: Record<string, unknown>;
};

export type EvidenceCheck = {
  kept: ProposalRow[];
  dropped: { proposal_id: string; reason: string }[];
};

function normalizeForMatch(v: string): string {
  return v.normalize("NFKC").toLocaleLowerCase("nb-NO").replace(/\s+/g, " ").trim();
}

/**
 * Evidensvalidering og deduplisering.
 * Et forslag beholdes kun når:
 *   - segment_id peker på en kandidat vi faktisk sendte inn
 *   - source_text finnes ordrett i kandidatteksten (ingen nye fakta)
 *   - forslaget ikke er duplikat på (kandidat, semantic_key)
 */
export function validateAndDedupe(
  batch: NormalizationBatch,
  segments: Segment[],
  ctx: {
    cvImportId: string;
    /** Per-kandidat innholdshash: segment.id -> sha256(kanonisk tekst). */
    segmentHashes: Map<string, string>;
    inputSignature: string;
    modelRunId: string;
    promptVersion: string;
    normalizerVersion: string;
  },
): EvidenceCheck {
  const bySegment = new Map(segments.map((s) => [s.id, s]));
  const kept: ProposalRow[] = [];
  const dropped: { proposal_id: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const p of batch.proposals) {
    const segment = bySegment.get(p.source.segment_id);
    if (!segment) {
      dropped.push({ proposal_id: p.proposal_id, reason: "ukjent segment_id" });
      continue;
    }
    if (p.review_state === "reject") {
      dropped.push({ proposal_id: p.proposal_id, reason: "modellen avviste forslaget" });
      continue;
    }
    if (!normalizeForMatch(segment.text).includes(normalizeForMatch(p.source.source_text))) {
      dropped.push({ proposal_id: p.proposal_id, reason: "sitatet finnes ikke i kildeteksten" });
      continue;
    }
    const dedupeKey = `${segment.id}::${p.semantic_key}`;
    if (seen.has(dedupeKey)) {
      dropped.push({ proposal_id: p.proposal_id, reason: "duplikat i samme batch" });
      continue;
    }
    seen.add(dedupeKey);

    const atomType = p.suggested_atom_type ?? segment.candidate.suggested_atom_type;
    const direct = DIRECT_TYPES.has(atomType);

    const segmentHash = ctx.segmentHashes.get(segment.id);
    if (!segmentHash) {
      dropped.push({ proposal_id: p.proposal_id, reason: "mangler kildehash" });
      continue;
    }

    kept.push({
      proposal_action: direct ? "create_atom" : "suggest_evidence",
      target_atom_type: "career_atom",
      source_type: "cv_import",
      source_table: "cv_parse_candidates",
      source_record_id: segment.candidate.id,
      source_id: ctx.cvImportId,
      source_import_id: ctx.cvImportId,
      source_hash: segmentHash,
      normalizer_version: ctx.normalizerVersion,
      prompt_version: ctx.promptVersion,
      model_run_id: ctx.modelRunId,
      confidence: Math.max(0, Math.min(1, p.confidence)),
      inferred: true,
      rationale: p.rationale.slice(0, 2000),
      explanation: p.clarification_question,
      proposal_payload: {
        atom_kind: "evidens",
        atom_type: atomType,
        content_no: p.normalized_no,
        source_type: "cv_import",
        source_ref: ctx.cvImportId,
        source_quote: p.source.source_text,
        confidence: "imported",
        structured_data: {
          parse_candidate_id: segment.candidate.id,
          cv_import_id: ctx.cvImportId,
          parse_local_ref: segment.candidate.local_ref,
          source_hash: segmentHash,
          input_signature: ctx.inputSignature,
          semantic_key: p.semantic_key,
          explicit_facts: p.explicit_facts,
          unsupported_implications: p.unsupported_implications,
          review_state: p.review_state,
          model_run_id: ctx.modelRunId,
          prompt_version: ctx.promptVersion,
          normalizer_version: ctx.normalizerVersion,
          generated_by: "cv-atom-language-no",
        },
      },
    });
  }

  return { kept, dropped };
}

/** Leverandørens egen batch-validering, brukt som ekstra sperre. */
export function vendorValidate(batch: NormalizationBatch) {
  return validateNormalizationBatch(batch);
}
