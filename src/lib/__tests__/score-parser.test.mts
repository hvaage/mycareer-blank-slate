import { describe, it, expect } from "vitest";

/**
 * Mirror of the parser used in supabase/functions/score-pending-opportunities/index.ts.
 * Strict validation: only finite numbers accepted, then clamped to [0, 100].
 * undefined, null, string, NaN, Infinity -> invalid_score (no DB write).
 */
export function parseScore(raw: unknown): { ok: true; score: number } | { ok: false; error: "invalid_score" } {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return { ok: false, error: "invalid_score" };
  }
  return { ok: true, score: Math.max(0, Math.min(100, raw)) };
}

describe("parseScore (B.parser strict validation)", () => {
  it("accepts explicit 0", () => expect(parseScore(0)).toEqual({ ok: true, score: 0 }));
  it("accepts 15", () => expect(parseScore(15)).toEqual({ ok: true, score: 15 }));
  it("accepts 100", () => expect(parseScore(100)).toEqual({ ok: true, score: 100 }));
  it("clamps 101 -> 100", () => expect(parseScore(101)).toEqual({ ok: true, score: 100 }));
  it("clamps -1 -> 0", () => expect(parseScore(-1)).toEqual({ ok: true, score: 0 }));
  it("rejects undefined", () => expect(parseScore(undefined)).toEqual({ ok: false, error: "invalid_score" }));
  it("rejects null", () => expect(parseScore(null)).toEqual({ ok: false, error: "invalid_score" }));
  it('rejects string "0"', () => expect(parseScore("0")).toEqual({ ok: false, error: "invalid_score" }));
  it('rejects string "15"', () => expect(parseScore("15")).toEqual({ ok: false, error: "invalid_score" }));
  it("rejects NaN", () => expect(parseScore(NaN)).toEqual({ ok: false, error: "invalid_score" }));
  it("rejects Infinity", () => expect(parseScore(Infinity)).toEqual({ ok: false, error: "invalid_score" }));
  it("rejects -Infinity", () => expect(parseScore(-Infinity)).toEqual({ ok: false, error: "invalid_score" }));
});
