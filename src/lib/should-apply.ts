// @ts-nocheck
/**
 * «Bør jeg søke?» foundation: separates preference mismatch from missing evidence vs weak positioning.
 * Deterministic heuristics only — no production ranking replacement.
 */

import type { WhitespaceAnalysisResult } from "@/lib/whitespace-analysis";

export type ShouldApplyBlockerReason =
  | "preference_mismatch"
  | "missing_evidence"
  | "weak_positioning"
  | "missing_information";

export type ShouldApplyBlocker = {
  type: ShouldApplyBlockerReason;
  detail: string;
};

export type ShouldApplyResult = {
  /** 0–100 composite hint (not Careerjet / employer AI). */
  apply_recommendation_score: number;
  /** 0–1 how much signal we had (atoms + optional requirements). */
  confidence: number;
  strengths: string[];
  risks: string[];
  blockers: ShouldApplyBlocker[];
  missingInformation: string[];
  /** Explicit split for explainability. */
  primaryGap: "preference_mismatch" | "missing_evidence" | "weak_positioning" | "none";
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Derive apply hint from white-space analysis. Critical distinction:
 * - **missing_evidence**: tomt eller nesten tomt bevisgrunnlag for prefererte områder.
 * - **preference_mismatch**: evidens finnes, men kategoriene støtter ikke preferansene (annen «historie»).
 * - **weak_positioning**: koblet evidens finnes, men styrke-bånd er lave.
 */
export function computeShouldApply(white: WhitespaceAnalysisResult, options?: { requirementCount?: number }): ShouldApplyResult {
  const reqN = options?.requirementCount ?? white.inferredRequirements.length;
  const hasPrefs = white.preferenceAlignment.some((r) => r.preferenceCount > 0);
  const hasEv = white.preferenceAlignment.some((r) => r.linkedEvidenceCount > 0);

  const missingEvidenceBlockers: ShouldApplyBlocker[] = white.missingEvidence.slice(0, 6).map((detail) => ({
    type: "missing_evidence" as const,
    detail,
  }));

  const preferenceMismatchBlockers: ShouldApplyBlocker[] = white.preferenceStoryMismatch.slice(0, 6).map((detail) => ({
    type: "preference_mismatch" as const,
    detail,
  }));

  const weakPositioningBlockers: ShouldApplyBlocker[] = white.weakEvidenceAreas.slice(0, 6).map((detail) => ({
    type: "weak_positioning" as const,
    detail,
  }));

  const missingInformation: string[] = [];
  if (!hasPrefs) missingInformation.push("Legg inn preferanse-atomer for å vurdere motivasjon og passform.");
  if (!hasEv) missingInformation.push("Legg inn evidens-atomer for å vurdere dokumentert styrke.");
  if (reqN > 0 && white.inferredRequirements.length === 0) {
    missingInformation.push("Ingen krav/roller spesifisert — stillings- eller selskapskontekst øker treffsikkerheten.");
  }

  const missingInfoBlockers: ShouldApplyBlocker[] = missingInformation.map((detail) => ({
    type: "missing_information" as const,
    detail,
  }));

  const blockers = [...missingInfoBlockers, ...missingEvidenceBlockers, ...preferenceMismatchBlockers, ...weakPositioningBlockers];

  let primaryGap: ShouldApplyResult["primaryGap"] = "none";
  if (preferenceMismatchBlockers.length) {
    primaryGap = "preference_mismatch";
  } else if (missingEvidenceBlockers.length) {
    primaryGap = "missing_evidence";
  } else if (weakPositioningBlockers.length >= 2) {
    primaryGap = "weak_positioning";
  }

  const strengths = [...white.matchedAreas, ...white.differentiationAngles].slice(0, 8);
  const risks = [...white.preferenceStoryMismatch, ...white.missingEvidence, ...white.weakEvidenceAreas].slice(0, 10);

  const signalCount =
    white.preferenceAlignment.reduce((n, r) => n + r.preferenceCount + r.linkedEvidenceCount, 0) + reqN * 0.5;
  const confidence = clamp01(signalCount / 25);

  let score = 55;
  score -= Math.min(30, missingEvidenceBlockers.length * 9);
  score -= Math.min(28, preferenceMismatchBlockers.length * 10);
  score -= Math.min(22, weakPositioningBlockers.length * 6);
  score -= missingInformation.length * 8;
  score += Math.min(20, strengths.length * 4);
  const apply_recommendation_score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    apply_recommendation_score,
    confidence,
    strengths,
    risks,
    blockers,
    missingInformation,
    primaryGap,
  };
}
