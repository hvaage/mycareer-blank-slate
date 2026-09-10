import { describe, expect, it } from "vitest";
import { isRelevantMatch, MATCH_SCORE_VERSION, matchDisplayState } from "../job-leads/match-state";

describe("jobb-leads matchvisning", () => {
  it("behandler gjeldende v8-vurderinger som autoritative", () => {
    const state = matchDisplayState({
      version: MATCH_SCORE_VERSION,
      screeningStatus: "needs_review",
      score: 0,
    });

    expect(state.aiEvaluated).toBe(true);
    expect(state.freshness).toBe("current");
    expect(state.screeningStatus).toBe("needs_review");
    expect(state.showScreeningDetails).toBe(true);
  });

  it("viser eldre positive scorer mens ny v8-vurdering mangler", () => {
    const state = matchDisplayState({
      version: "job_match_v7_2026_08_26",
      screeningStatus: "eligible",
      score: 86,
    });

    expect(state.aiEvaluated).toBe(true);
    expect(state.freshness).toBe("legacy_positive");
    expect(isRelevantMatch(state, 70)).toBe(true);
    expect(state.showScreeningDetails).toBe(false);
  });

  it("viderefører ikke eldre eksklusjoner som aktive beslutninger", () => {
    const state = matchDisplayState({
      version: "job_match_v7_2026_08_26",
      screeningStatus: "excluded",
      score: 0,
    });

    expect(state.aiEvaluated).toBe(false);
    expect(state.screeningStatus).toBeNull();
    expect(state.score).toBeNull();
  });
});
