/**
 * Module 3 — Career Intelligence: match assessment domain constants and helpers.
 * Uses the agreed 1–6 scale for dimension-style scores (weak / moderate / strong bands).
 * Overall / apply scores may later be stored as 0–100; helpers support both where noted.
 */

import {
  MATCH_SCORE_MAX,
  MATCH_SCORE_MIN,
  clampMatchScore,
  matchScoreBand,
  matchScoreBandLabelNb,
  type MatchScoreBand,
} from "@/lib/career-match-dimensions";

/** High-level assessment target (stored on `match_assessments.assessment_type`). */
export const MATCH_ASSESSMENT_TYPES = ["employer", "opportunity", "company_only", "opportunity_only"] as const;
export type MatchAssessmentType = (typeof MATCH_ASSESSMENT_TYPES)[number];

/** Lifecycle on `match_assessments.status`. */
export const MATCH_ASSESSMENT_STATUSES = ["draft", "completed", "stale", "failed"] as const;
export type MatchAssessmentStatus = (typeof MATCH_ASSESSMENT_STATUSES)[number];

/** Aggregated match band on header row (`match_assessments.match_band`). */
export const MATCH_HEADER_BANDS = ["weak", "moderate", "strong"] as const;
export type MatchHeaderBand = (typeof MATCH_HEADER_BANDS)[number];

/** Positioning row category (`positioning_recommendations.category`). */
export const POSITIONING_RECOMMENDATION_CATEGORIES = [
  "cv",
  "cover_letter",
  "linkedin",
  "networking",
  "interview",
  "portfolio",
  "experience_gap",
  "positioning",
  /** Foundations for later modules — no integrations yet. */
  "linkedin_optimization",
  "network_leverage",
  "references",
  "internal_contacts",
  "reputation_positioning",
] as const;
export type PositioningRecommendationCategory = (typeof POSITIONING_RECOMMENDATION_CATEGORIES)[number];

export const POSITIONING_RECOMMENDATION_STATUSES = ["open", "dismissed", "completed"] as const;
export type PositioningRecommendationStatus = (typeof POSITIONING_RECOMMENDATION_STATUSES)[number];

/** 1–6 dimension score → weak | moderate | strong (re-exports career-match bands). */
export function scoreToBand(score: number | null | undefined): MatchScoreBand | null {
  return matchScoreBand(score);
}

export function bandLabelNb(band: MatchScoreBand | null | undefined): string {
  if (!band) return "—";
  return matchScoreBandLabelNb(band);
}

/**
 * Map overall 0–100 style score to a coarse apply hint (foundation only; not production ranking).
 */
export function shouldApplyBand(overallScore0to100: number | null | undefined): "low" | "medium" | "high" | null {
  if (overallScore0to100 == null || Number.isNaN(overallScore0to100)) return null;
  const s = Math.max(0, Math.min(100, Math.round(Number(overallScore0to100))));
  if (s < 40) return "low";
  if (s < 70) return "medium";
  return "high";
}

export function shouldApplyBandLabelNb(band: ReturnType<typeof shouldApplyBand>): string {
  switch (band) {
    case "low":
      return "Begrenset treff — vurder nøye";
    case "medium":
      return "Moderat treff — mulig, med forberedelse";
    case "high":
      return "God treff — søk gjerne om det passer deg";
    default:
      return "Ukjent";
  }
}

/** Norwegian copy for evidence strength on 1–6. */
export function evidenceStrengthLabel(score: number | null | undefined): string {
  const band = matchScoreBand(score == null ? null : clampMatchScore(Number(score)));
  switch (band) {
    case "weak":
      return "Svak dokumentasjon — bygg bevis og eksempler";
    case "moderate":
      return "Moderat dokumentasjon — tydeliggjør resultater";
    case "strong":
      return "Sterk dokumentasjon — godt grunnlag å vise frem";
    default:
      return "Ikke vurdert";
  }
}

/** Threshold helpers for 1–6 UI and future rules. */
export function isWeakDimensionScore(score: number | null | undefined): boolean {
  const b = matchScoreBand(score);
  return b === "weak";
}

export function isStrongDimensionScore(score: number | null | undefined): boolean {
  const b = matchScoreBand(score);
  return b === "strong";
}

export function dimensionScoreInRange(score: number | null | undefined): score is number {
  if (score == null || Number.isNaN(score)) return false;
  const s = Math.round(Number(score));
  return s >= MATCH_SCORE_MIN && s <= MATCH_SCORE_MAX;
}

/** Map 0–100 to header weak/moderate/strong for `match_band` when not using 1–6. */
export function overall100ToHeaderBand(score: number | null | undefined): MatchHeaderBand | null {
  if (score == null || Number.isNaN(score)) return null;
  const s = Math.max(0, Math.min(100, Math.round(Number(score))));
  if (s < 40) return "weak";
  if (s < 70) return "moderate";
  return "strong";
}
