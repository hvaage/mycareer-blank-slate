export const MATCH_SCORE_VERSION = "job_match_v8_2026_09_10";

const LEGACY_MATCH_SCORE_VERSIONS = new Set<string>([
  "job_match_v7_2026_08_26",
  "job_match_v6_2026_08_25",
  "job_match_v5_2026_08_25",
  "job_match_v4_2026_08_23",
  "job_match_v3_2026_08_15",
  "job_match_v2_2026_06_24",
]);

export type ScreeningStatus = "eligible" | "excluded" | "needs_review" | null;
export type MatchFreshness = "current" | "legacy_positive" | "stale_or_unknown";

export type DisplayMatchState = {
  aiEvaluated: boolean;
  freshness: MatchFreshness;
  score: number | null;
  screeningStatus: ScreeningStatus;
  showScreeningDetails: boolean;
  showPositiveHighlights: boolean;
};

function finiteScore(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function isCurrentMatchEvaluated(
  version: string | null | undefined,
  status: ScreeningStatus,
): boolean {
  return version === MATCH_SCORE_VERSION && status != null;
}

export function isLegacyScoreVersion(version: string | null | undefined): boolean {
  return !!version && LEGACY_MATCH_SCORE_VERSIONS.has(version);
}

export function matchDisplayState(input: {
  version: string | null | undefined;
  screeningStatus: ScreeningStatus;
  score: unknown;
}): DisplayMatchState {
  const score = finiteScore(input.score);
  if (isCurrentMatchEvaluated(input.version, input.screeningStatus)) {
    return {
      aiEvaluated: true,
      freshness: "current",
      score,
      screeningStatus: input.screeningStatus,
      showScreeningDetails: true,
      showPositiveHighlights: input.screeningStatus === "eligible",
    };
  }

  if (
    isLegacyScoreVersion(input.version) &&
    input.screeningStatus === "eligible" &&
    score !== null
  ) {
    return {
      aiEvaluated: true,
      freshness: "legacy_positive",
      score,
      screeningStatus: "eligible",
      showScreeningDetails: false,
      showPositiveHighlights: true,
    };
  }

  return {
    aiEvaluated: false,
    freshness: "stale_or_unknown",
    score: null,
    screeningStatus: null,
    showScreeningDetails: false,
    showPositiveHighlights: false,
  };
}

export function isRelevantMatch(
  state: Pick<DisplayMatchState, "aiEvaluated" | "score" | "screeningStatus">,
  minScore: number,
): boolean {
  return (
    state.aiEvaluated &&
    state.screeningStatus === "eligible" &&
    typeof state.score === "number" &&
    state.score >= minScore
  );
}
