// cv-hallucination-guard — TypeScript types

// ---------------------------------------------------------------------------
// AtomLike — minimum-interface av atom som guarden bryr seg om.
// Kompatibel med CvAtom fra cv-evidence-graph, men uavhengig deklarert
// for å unngå cross-Skill type-dependency.
// ---------------------------------------------------------------------------

export interface AtomLike {
  id: string;
  atom_type: string;
  parent_atom_id?: string | null;
  content_no?: string | null;
  content_en?: string | null;
  structured_data?: Record<string, unknown> | null;
  source_quote?: string | null;
  confidence?: "verified" | "imported" | "inferred";
  user_confirmed?: boolean;
  user_locked?: boolean;
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

export type ClaimType =
  | "number"          // tall, beløp, prosent, antall
  | "date"            // år, måned, varighet
  | "entity"          // selskap, institusjon, sertifikat
  | "position"        // tittel, reporting-line, organisatorisk
  | "verb_action"     // soft: hva kandidaten gjorde
  | "qualifier";      // soft: egenskap eller karakteristikk

export interface ExtractedClaim {
  /** Type claim */
  type: ClaimType;
  /** Den eksakte teksten som ble identifisert som claim */
  text: string;
  /** Posisjon i kilde-teksten (start-indeks) */
  position: number;
  /** Strukturert tolkning av claim — felter avhenger av type */
  parsed: Record<string, unknown>;
  /** Om claim regnes som hard (eksakt) eller soft (semantisk) */
  is_hard: boolean;
}

// ---------------------------------------------------------------------------
// Match-resultater
// ---------------------------------------------------------------------------

export type MatchVerdict =
  | "verified"        // claim støttes av atom(s)
  | "partial"         // lignende fakta finnes, men avvikende presisjon
  | "unverified"      // ingen støtte funnet
  | "contradicted";   // atom motsier claim

export interface ClaimMatch {
  claim: ExtractedClaim;
  verdict: MatchVerdict;
  /** Konfidensgrad 0–1 */
  confidence: number;
  /** Atoms som ble vurdert som støtte/motstand */
  supporting_atom_ids: string[];
  /** Forklarende tekst (på norsk) for UI eller logging */
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Guard-resultat
// ---------------------------------------------------------------------------

export type GuardMode = "fast" | "standard" | "strict";

export interface GuardResult {
  /** True hvis ingen claims er unverified eller contradicted */
  ok: boolean;
  /** Modus brukt for verifikasjon */
  mode: GuardMode;
  /** Alle claims som ble vurdert */
  matches: ClaimMatch[];
  /** Subset: kun de som er unverified */
  unverified: ClaimMatch[];
  /** Subset: kun de som er contradicted */
  contradicted: ClaimMatch[];
  /** Subset: kun de som er partial */
  partial: ClaimMatch[];
  /** Total antall hard og soft claims funnet */
  stats: {
    total: number;
    hard: number;
    soft: number;
    verified: number;
  };
  /** Versjon av guard-reglene som ble brukt */
  guard_version: string;
  evidence_scope: {
    eligible_atom_count: number;
    excluded_atom_ids: string[];
    legacy_atom_ids: string[];
  };
  warnings: string[];
}

// ---------------------------------------------------------------------------
// LLM-judge interface
// ---------------------------------------------------------------------------

export interface LlmJudgeInput {
  claim: ExtractedClaim;
  candidate_atoms: AtomLike[];
  language: "no" | "en";
}

export interface LlmJudgeResponse {
  verdict: MatchVerdict;
  confidence: number;
  reasoning: string;
  supporting_atom_ids: string[];
}

export interface ValidatedLlmJudgeResponse extends LlmJudgeResponse {
  invalid_supporting_atom_ids: string[];
}

export interface LlmJudgeClient {
  judge(input: LlmJudgeInput): Promise<LlmJudgeResponse>;
}
