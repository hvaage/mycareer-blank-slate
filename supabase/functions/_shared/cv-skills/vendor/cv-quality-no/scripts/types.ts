// cv-quality-no — TypeScript types

// ---------------------------------------------------------------------------
// Quality issue
// ---------------------------------------------------------------------------

export type QualitySeverity = "critical" | "important" | "minor" | "info";

export type QualityCategory =
  | "verb_strength"      // svak åpningsverb
  | "tense_consistency"  // blanding av preteritum og presens
  | "ai_tell"            // AI-typisk klisjé
  | "cliche"             // overdrevent adjektiv eller fluff
  | "readability"        // for lang setning, kompleks subordinasjon
  | "repetition"         // gjentatt verb eller adjektiv
  | "person_consistency" // blanding av førsteperson og upersonlig
  | "language_mixing";   // norsk og engelsk blandet

export interface QualityIssue {
  severity: QualitySeverity;
  category: QualityCategory;
  rule_id: string;
  message: string;             // forklaring til brukeren (på norsk)
  field_path: string | null;   // posisjon i tekst, f.eks. char-offset eller "bullet[2]"
  matched_text: string | null; // teksten som utløste issue (for highlighting i UI)
  suggestion: string | null;   // konkret forbedringsforslag
}

// ---------------------------------------------------------------------------
// Check input — kontekst for hva slags tekst vi sjekker
// ---------------------------------------------------------------------------

export type TextContext =
  | "achievement"        // bullet under en rolle
  | "summary"            // profilsammendrag
  | "role_description"   // beskrivelse over bullets
  | "cover_letter";      // søknadsbrev

export interface CheckInput {
  text: string;
  language: "no" | "en";
  context: TextContext;
  /** True hvis dette er nåværende rolle (påvirker verb-tid-forventning) */
  is_current_role?: boolean;
  /** Andre tekster i samme CV — for repetisjons-sjekk */
  sibling_texts?: string[];
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface QualityCheckResult {
  /** True hvis ingen critical eller important issues */
  ok: boolean;
  issues: QualityIssue[];
  critical: QualityIssue[];
  important: QualityIssue[];
  minor: QualityIssue[];
  infos: QualityIssue[];
  /** Statistikk for rapportering */
  stats: {
    word_count: number;
    sentence_count: number;
    avg_words_per_sentence: number;
  };
}

// ---------------------------------------------------------------------------
// Rewrite
// ---------------------------------------------------------------------------

export interface RewriteRequest {
  original_text: string;
  issues: QualityIssue[];
  language: "no" | "en";
  context: TextContext;
  supporting_atom_ids: string[];
  source_claims: string[];
  preserve_facts: true;
}

export interface RewriteResponse {
  rewritten_text: string;
  changes_made: string[];   // kort liste over hva som ble endret
  supporting_atom_ids: string[];
  preserved_claims: string[];
  introduced_claims: string[];
  requires_guard: true;
}

export interface RewriteValidationResult {
  ok: boolean;
  missing_hard_tokens: string[];
  introduced_hard_tokens: string[];
  missing_required_claims: string[];
  invalid_atom_ids: string[];
}

export interface RewriteClient {
  rewrite(request: RewriteRequest): Promise<RewriteResponse>;
}
