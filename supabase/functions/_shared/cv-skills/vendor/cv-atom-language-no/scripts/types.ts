export type SemanticRelation = "equivalent" | "related" | "distinct" | "uncertain";
export type ReviewState = "ready_for_atom" | "needs_review" | "reject";

export interface SourceSpan {
  segment_id: string;
  source_text: string;
  start_offset: number | null;
  end_offset: number | null;
}

export interface SemanticConcept {
  id: string;
  label_no: string;
  role: "action" | "object" | "method" | "context" | "result" | "metric" | "qualifier";
  explicit: boolean;
}

export interface NormalizationProposal {
  proposal_id: string;
  source: SourceSpan;
  normalized_no: string;
  semantic_key: string;
  concepts: SemanticConcept[];
  suggested_atom_type:
    | "role" | "achievement" | "metric" | "context" | "tool"
    | "education" | "skill" | "language" | "certification"
    | "project" | "volunteer" | "summary_fragment" | null;
  explicit_facts: string[];
  unsupported_implications: string[];
  confidence: number;
  review_state: ReviewState;
  rationale: string;
  clarification_question: string | null;
}

export interface SemanticComparison {
  relation: SemanticRelation;
  confidence: number;
  shared_concepts: string[];
  conflicting_signals: string[];
  reason: string;
}

export interface NormalizationBatch {
  schema_version: "1.0";
  language: "no";
  source_type: string;
  source_id: string;
  source_hash: string;
  proposals: NormalizationProposal[];
  warnings: string[];
}

export interface NormalizationValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}
