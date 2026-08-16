import { describe, expect, it } from "vitest";
import { groupResultsByRole, isResultCandidate } from "@/components/cv/CvReviewResultsStep";
import type { CvParseCandidateRow } from "@/lib/queries/cv-parse-candidates";
import type { TimelineRole } from "@/lib/cv-review-timeline";

function candidate(p: Partial<CvParseCandidateRow> & { id: string }): CvParseCandidateRow {
  return {
    content_no: p.id,
    parent_local_ref: null,
    suggested_atom_type: "achievement",
    resolved_atom_type: null,
    status: "ubehandlet",
    ...p,
  } as unknown as CvParseCandidateRow;
}

function role(id: string, title: string): TimelineRole {
  return {
    id,
    kind: "lagret",
    title,
    titleMissing: false,
    summary: null,
    employer: null,
    startIso: "2020-01-01",
    endIso: null,
    startPrecision: "maned",
    endPrecision: null,
    isCurrent: false,
    candidate: null,
    missingDates: false,
  };
}

describe("groupResultsByRole", () => {
  it("plasserer resultater under rollen de hører til", () => {
    const groups = groupResultsByRole(
      [candidate({ id: "r1", parent_local_ref: "L1" })],
      [role("atom-1", "Rådgiver")],
      new Map([["L1", "atom-1"]]),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.roleAtomId).toBe("atom-1");
    expect(groups[0]!.candidates.map((c) => c.id)).toEqual(["r1"]);
  });

  it("samler resultater uten kjent rolle for seg", () => {
    const groups = groupResultsByRole([candidate({ id: "r2" })], [role("atom-1", "A")], new Map());
    expect(groups).toHaveLength(1);
    expect(groups[0]!.role).toBeNull();
  });
});

describe("isResultCandidate", () => {
  it("tar bare med resultattyper", () => {
    expect(isResultCandidate(candidate({ id: "a", suggested_atom_type: "achievement" }))).toBe(true);
    expect(isResultCandidate(candidate({ id: "b", suggested_atom_type: "skill" }))).toBe(false);
  });
});
