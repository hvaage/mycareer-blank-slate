// cv-atom-language-no v2.1.0 — rollebevisst atomiseringskontrakt.
//
// Ren typedefinisjon. Ingen database, ingen nettverk, ingen modellkall.
// Kontrakten er kanonisk for både prompt, validering og evaluering.

export const CV_ATOMIZATION_SKILL_VERSION = "2.1.0";

export type SectionHint = "experience" | "education" | "skills" | "summary" | "other";

export type SourceSpan = {
  id: string;
  page?: number | null;
  startOffset?: number | null;
  endOffset?: number | null;
  text: string;
  sectionHint?: SectionHint;
  localRef?: string;
  parentLocalRef?: string | null;
};

export type RoleBlock = {
  id: string;
  sourceSpanIds: string[];
  rawText: string;
  title?: string | null;
  employer?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  datePrecision?: "day" | "month" | "year" | null;
  employmentGroupKey?: string | null;
  appointmentHints?: string[];
};

export type CvAtomizationInput = {
  documentLanguage: "no" | "en" | "mixed";
  sourceSpans: SourceSpan[];
  roleBlocks: RoleBlock[];
  unassignedSpans: string[];
  normalizerVersion: string;
};

/**
 * Kildebelegg. Modellen returnerer kun sourceSpanId; sourceQuote, side og
 * offset hydreres av serveren fra det frosne inputtet. Da kan et sitat aldri
 * avvike fra kilden, og modellen slipper å gjenta lange utdrag.
 */
export type SourceEvidence = {
  sourceSpanId: string;
  sourceQuote: string;
  page?: number | null;
  startOffset?: number | null;
  endOffset?: number | null;
};

export type AppointmentRelation = "single" | "successive" | "concurrent" | "ambiguous";

export type RoleAtomProposal = {
  localId: string;
  roleBlockId: string | null;
  employmentGroupKey: string | null;
  title: string | null;
  employer: string | null;
  startDate: string | null;
  endDate: string | null;
  datePrecision: "day" | "month" | "year" | null;
  sourceEvidence: SourceEvidence[];
  appointmentRelation: AppointmentRelation;
  predecessorRoleLocalId: string | null;
  concurrentWithRoleLocalIds: string[];
  status: "proposed" | "needs_review";
  /**
   * Provisorisk rolleblokk: perioden og arbeidsgiveren er strukturelt sikre,
   * men noe mangler (typisk stillingstittel). Avklaringen hører hjemme på
   * rollen — ikke på hvert enkelt resultat under den.
   */
  provisional?: boolean;
  needsReviewReason?: "missing_role_title" | "merged_role_detected" | null;
  issues: string[];
};

export type PlacementConfidence = "high" | "low" | "needs_review";

/**
 * Strukturell kilde til plasseringen. Utledes deterministisk av serveren, ikke
 * av modellen. Bare de tre første regnes som strukturelt grunnlag.
 */
export type PlacementSource =
  | "role_block_parent"
  | "role_block_span"
  | "inner_appointment_span"
  | "model_text_only"
  | "none";

/**
 * Innholdstype. Skiller hva innholdet ER fra hvor det HØRER HJEMME.
 * Rolleplassering avgjøres av `placementSource`, ikke av denne.
 */
export type ContentKind = "result" | "deliverable" | "role_evidence";

export type AchievementProposal = {
  localId: string;
  roleLocalId: string | null;
  normalizedText: string;
  sourceEvidence: SourceEvidence[];
  placementConfidence: PlacementConfidence;
  placementSource: PlacementSource;
  placementReasons: string[];
  contentKind?: ContentKind;
  status: "proposed" | "unassigned" | "needs_review";
  issues: string[];
};

export type SkillEvidenceRef = {
  roleLocalId?: string | null;
  achievementLocalId?: string | null;
  sourceEvidence: SourceEvidence[];
};

export type SkillProposal = {
  localId: string;
  canonicalLabelNo: string;
  displayLabel: string;
  canonicalKey: string;
  inferred: boolean;
  evidence: SkillEvidenceRef[];
  placementConfidence: PlacementConfidence;
  placementReasons: string[];
  status: "proposed" | "needs_review";
  issues: string[];
};

export type QualificationProposal = {
  localId: string;
  kind: "education" | "certification" | "language" | "tool";
  normalizedText: string;
  sourceEvidence: SourceEvidence[];
  status: "proposed" | "needs_review";
  issues: string[];
};

export type AtomizationIssueCode =
  | "missing_role_structure"
  | "role_candidate_misclassified"
  | "achievement_unassigned"
  | "skill_needs_review"
  | "insufficient_source_evidence"
  | "ambiguous_compound_skill"
  | "merged_role_detected"
  | "multi_role_appointment_ambiguous";

export type AtomizationIssue = {
  code: AtomizationIssueCode;
  sourceSpanIds: string[];
  message: string;
};

export type CvAtomizationOutput = {
  roles: RoleAtomProposal[];
  achievements: AchievementProposal[];
  skills: SkillProposal[];
  qualifications: QualificationProposal[];
  issues: AtomizationIssue[];
};

export const ATOMIZATION_ISSUE_CODES: readonly AtomizationIssueCode[] = [
  "missing_role_structure",
  "role_candidate_misclassified",
  "achievement_unassigned",
  "skill_needs_review",
  "insufficient_source_evidence",
  "ambiguous_compound_skill",
  "merged_role_detected",
  "multi_role_appointment_ambiguous",
];
