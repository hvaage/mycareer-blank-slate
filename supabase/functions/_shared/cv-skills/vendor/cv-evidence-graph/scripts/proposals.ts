import type {
  AtomInsert,
  AtomProposal,
  AtomProvenance,
  CvAtom,
} from "./types.ts";
import { validateAtom } from "./validators.ts";

export const EVIDENCE_PROPOSAL_SCHEMA_VERSION = "1.1";

export interface ProposalValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateAtomProposal(proposal: AtomProposal): ProposalValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (proposal.schema_version !== "1.1") errors.push("Ukjent schema_version");
  if (!proposal.user_id || !proposal.proposal_id) errors.push("proposal_id og user_id er påkrevd");
  if (!proposal.provenance.source_hash || !proposal.provenance.source_quote.trim()) {
    errors.push("Kildehash og kildeutdrag er påkrevd");
  }
  if (proposal.confidence < 0 || proposal.confidence > 1) errors.push("confidence må være 0-1");
  if (proposal.requires_user_confirmation !== true) errors.push("Alle forslag krever brukerbekreftelse");
  if (proposal.action === "create" && !proposal.proposed_atom) errors.push("create krever proposed_atom");
  if (["update", "merge", "deactivate"].includes(proposal.action) && !proposal.target_atom_id) {
    errors.push(proposal.action + " krever target_atom_id");
  }
  if (proposal.proposed_atom) {
    const atomResult = validateAtom(proposal.proposed_atom);
    if (!atomResult.ok) errors.push(atomResult.error ?? "Ugyldig atom");
    warnings.push(...(atomResult.warnings ?? []));
  }
  if (proposal.inferred) warnings.push("Forslaget inneholder inferens og kan ikke brukes før review");
  return { ok: errors.length === 0, errors, warnings };
}

export function createAtomProposal(input: {
  proposal_id: string;
  user_id: string;
  proposed_atom: AtomInsert;
  provenance: AtomProvenance;
  semantic_key?: string | null;
  rationale: string;
  confidence: number;
  inferred?: boolean;
}): AtomProposal {
  return {
    schema_version: "1.1",
    proposal_id: input.proposal_id,
    user_id: input.user_id,
    action: "create",
    status: "pending_review",
    target_atom_id: null,
    proposed_atom: input.proposed_atom,
    existing_atom_snapshot: null,
    provenance: input.provenance,
    semantic_key: input.semantic_key ?? null,
    rationale: input.rationale,
    confidence: input.confidence,
    inferred: input.inferred ?? false,
    requires_user_confirmation: true,
  };
}

export function createMergeProposal(input: {
  proposal_id: string;
  user_id: string;
  target: CvAtom;
  proposed_atom: AtomInsert;
  provenance: AtomProvenance;
  semantic_key?: string | null;
  rationale: string;
  confidence: number;
}): AtomProposal {
  return {
    schema_version: "1.1",
    proposal_id: input.proposal_id,
    user_id: input.user_id,
    action: "merge",
    status: "pending_review",
    target_atom_id: input.target.id,
    proposed_atom: input.proposed_atom,
    existing_atom_snapshot: input.target,
    provenance: input.provenance,
    semantic_key: input.semantic_key ?? null,
    rationale: input.rationale,
    confidence: input.confidence,
    inferred: input.proposed_atom.confidence === "inferred",
    requires_user_confirmation: true,
  };
}
