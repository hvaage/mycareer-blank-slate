import type { NormalizationBatch, NormalizationValidation, SemanticComparison } from "./types.ts";

export const NORMALIZER_VERSION = "1.0.0";

const CONCEPT_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\b(skapte|byg(?:de|get)|etablerte)\s+(?:en\s+)?(?:kultur\s+(?:rundt|for)\s+(?:tydelig\s+)?ledelse|ledelseskultur)\b/i, "build:leadership-culture"],
  [/\b(?:salgsorganisasjon|organisasjon\s+for\s+salg)\b/i, "object:sales-organization"],
  [/\b(?:partnerstrategi|strategi\s+for\s+partnere)\b/i, "object:partner-strategy"],
  [/\b(?:endringsledelse|ledelse\s+av\s+endring)\b/i, "domain:change-leadership"],
  [/\b(?:forretningsutvikling|utvikling\s+av\s+forretning(?:en)?)\b/i, "domain:business-development"],
  [/\b(?:kostnadsreduksjon|reduksjon\s+av\s+kostnader)\b/i, "result:cost-reduction"],
  [/\b(?:kompetansebygging|bygging\s+av\s+kompetanse)\b/i, "action:capability-building"],
];

const OWNERSHIP_SIGNALS: ReadonlyArray<[RegExp, string]> = [
  [/\b(?:ledet|eide|drev)\b/i, "ownership:lead"],
  [/\b(?:koordinerte|hadde ansvar for|ansvar for)\b/i, "ownership:responsible"],
  [/\b(?:bidro til|deltok i|var med på)\b/i, "ownership:contributed"],
];

function canonicalText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("nb-NO")
    .replace(/[^\p{L}\p{N}%+&./-]+/gu, " ").trim().replace(/\s+/g, " ");
}

export function extractSemanticSignals(text: string): string[] {
  const signals = new Set<string>();
  for (const [pattern, concept] of [...CONCEPT_PATTERNS, ...OWNERSHIP_SIGNALS]) {
    if (pattern.test(text)) signals.add(concept);
  }
  return [...signals].sort();
}

export function buildSemanticKey(text: string): string {
  const signals = extractSemanticSignals(text);
  return signals.length > 0 ? signals.join("|") : canonicalText(text);
}

function tokenSet(text: string): Set<string> {
  return new Set(canonicalText(text).split(" ").filter((token) => token.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function compareSemanticExpressions(a: string, b: string): SemanticComparison {
  const aSignals = extractSemanticSignals(a);
  const bSignals = extractSemanticSignals(b);
  const shared = aSignals.filter((signal) => bSignals.includes(signal));
  const aOwnership = aSignals.find((signal) => signal.startsWith("ownership:"));
  const bOwnership = bSignals.find((signal) => signal.startsWith("ownership:"));
  const conflicts = aOwnership && bOwnership && aOwnership !== bOwnership
    ? [`${aOwnership} != ${bOwnership}`] : [];

  if (shared.length > 0 && conflicts.length === 0) {
    return { relation: "equivalent", confidence: Math.min(0.98, 0.82 + shared.length * 0.05), shared_concepts: shared, conflicting_signals: [], reason: "Uttrykkene deler eksplisitte norske semantiske konsepter og har kompatibelt eierskap." };
  }
  const similarity = jaccard(tokenSet(a), tokenSet(b));
  if (conflicts.length > 0) {
    return { relation: "related", confidence: 0.75, shared_concepts: shared, conflicting_signals: conflicts, reason: "Uttrykkene gjelder samme område, men beskriver ulik grad av eierskap." };
  }
  if (similarity >= 0.65) {
    return { relation: "related", confidence: similarity, shared_concepts: shared, conflicting_signals: [], reason: "Høy tekstlig likhet uten tilstrekkelig konseptbelegg for automatisk ekvivalens." };
  }
  return { relation: similarity < 0.2 ? "distinct" : "uncertain", confidence: similarity < 0.2 ? 1 - similarity : 0.5, shared_concepts: shared, conflicting_signals: [], reason: similarity < 0.2 ? "Ingen tydelig semantisk eller tekstlig overlapp." : "Noe tekstlig overlapp, men betydningen må vurderes i kildekontekst." };
}

export function validateNormalizationBatch(batch: NormalizationBatch): NormalizationValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (batch.schema_version !== "1.0") errors.push("Ukjent schema_version");
  if (batch.language !== "no") errors.push("Skillen støtter bare bokmål i denne versjonen");
  if (!batch.source_id || !batch.source_hash) errors.push("source_id og source_hash er påkrevd");
  const ids = new Set<string>();
  for (const proposal of batch.proposals) {
    if (ids.has(proposal.proposal_id)) errors.push(`Duplikat proposal_id: ${proposal.proposal_id}`);
    ids.add(proposal.proposal_id);
    if (!proposal.source.source_text.trim()) errors.push(`${proposal.proposal_id}: source_text mangler`);
    if (!proposal.normalized_no.trim()) errors.push(`${proposal.proposal_id}: normalized_no mangler`);
    if (!proposal.semantic_key.trim()) errors.push(`${proposal.proposal_id}: semantic_key mangler`);
    if (proposal.confidence < 0 || proposal.confidence > 1) errors.push(`${proposal.proposal_id}: confidence utenfor 0-1`);
    if (proposal.review_state === "ready_for_atom" && proposal.confidence < 0.8) errors.push(`${proposal.proposal_id}: ready_for_atom krever confidence >= 0.8`);
    if (proposal.unsupported_implications.length > 0 && proposal.review_state === "ready_for_atom") errors.push(`${proposal.proposal_id}: unsupported_implications krever review`);
    if (proposal.concepts.some((concept) => !concept.explicit)) warnings.push(`${proposal.proposal_id}: inneholder implisitte konsepter`);
  }
  return { ok: errors.length === 0, errors, warnings };
}
