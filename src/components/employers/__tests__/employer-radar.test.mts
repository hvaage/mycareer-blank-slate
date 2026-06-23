import { describe, expect, it } from "vitest";
import { shouldDrawRadarPolygon } from "../EmployerDimensionsRadarV2";

const eight = (scores: Array<number | null>) => scores.map((score) => ({ score }));

describe("shouldDrawRadarPolygon", () => {
  it("returns true when all 8 dimensions have valid scores", () => {
    expect(shouldDrawRadarPolygon(eight([1, 2, 3, 4, 5, 3.5, 4.2, 2.8]))).toBe(true);
  });

  it("returns false when 7 valid scores + 1 null", () => {
    expect(shouldDrawRadarPolygon(eight([1, 2, 3, 4, 5, 3.5, 4.2, null]))).toBe(false);
  });

  it("returns false when one of 8 scores is NaN", () => {
    expect(shouldDrawRadarPolygon(eight([1, 2, 3, 4, 5, 3.5, 4.2, NaN]))).toBe(false);
  });

  it("returns false when fewer than 8 dimensions are provided", () => {
    expect(shouldDrawRadarPolygon(eight([1, 2, 3, 4, 5, 3.5, 4.2]))).toBe(false);
  });
});
