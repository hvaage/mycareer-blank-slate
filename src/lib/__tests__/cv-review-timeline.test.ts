import { describe, expect, it } from "vitest";
import {
  candidateSetSignature,
  detectGaps,
  extractRoleTitle,
  monthsBetween,
  normalizeDateToIso,
  sortRoles,
  type TimelineRole,
} from "@/lib/cv-review-timeline";

function role(p: Partial<TimelineRole> & { id: string }): TimelineRole {
  return {
    kind: "kandidat",
    title: p.id,
    titleMissing: false,
    summary: null,
    employer: null,
    startIso: null,
    endIso: null,
    startPrecision: p.startIso ? "maned" : null,
    endPrecision: p.endIso ? "maned" : null,
    isCurrent: false,
    candidate: null,
    missingDates: false,
    ...p,
  };
}

describe("normalizeDateToIso", () => {
  it("normaliserer år, måned og fulle datoer", () => {
    expect(normalizeDateToIso("2019")).toBe("2019-01-01");
    expect(normalizeDateToIso("2019-4")).toBe("2019-04-01");
    expect(normalizeDateToIso("04.2019")).toBe("2019-04-01");
    expect(normalizeDateToIso("2019-04-07")).toBe("2019-04-07");
    expect(normalizeDateToIso("07.04.2019")).toBe("2019-04-07");
  });

  it("gjetter ikke på ukjent format", () => {
    expect(normalizeDateToIso("våren 2019")).toBeNull();
    expect(normalizeDateToIso(null)).toBeNull();
  });
});

describe("sortRoles", () => {
  it("sorterer nyeste først og legger udaterte sist", () => {
    const out = sortRoles([
      role({ id: "a", startIso: "2015-01-01" }),
      role({ id: "b" }),
      role({ id: "c", startIso: "2021-01-01" }),
    ]);
    expect(out.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});

describe("detectGaps", () => {
  it("markerer ikke hull under tre måneder", () => {
    expect(
      detectGaps([
        role({ id: "a", startIso: "2015-01-01", endIso: "2016-01-01" }),
        role({ id: "b", startIso: "2016-03-01", endIso: "2017-01-01" }),
      ]),
    ).toEqual([]);
  });

  it("viser hull på nøyaktig tre måneder", () => {
    const gaps = detectGaps([
      role({ id: "a", title: "A", startIso: "2015-01-01", endIso: "2016-01-01" }),
      role({ id: "b", title: "B", startIso: "2016-04-01", endIso: "2017-01-01" }),
    ]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.months).toBe(3);
    expect(gaps[0]!.afterTitle).toBe("A");
    expect(gaps[0]!.beforeTitle).toBe("B");
  });

  it("viser hull på fem måneder", () => {
    const gaps = detectGaps([
      role({ id: "a", startIso: "2015-01-01", endIso: "2016-01-01" }),
      role({ id: "b", startIso: "2016-06-01", endIso: "2017-01-01" }),
    ]);
    expect(gaps.map((g) => g.months)).toEqual([5]);
  });

  it("viser hull på seks måneder", () => {
    const gaps = detectGaps([
      role({ id: "a", startIso: "2015-01-01", endIso: "2016-01-01" }),
      role({ id: "b", startIso: "2016-07-01", endIso: "2017-01-01" }),
    ]);
    expect(gaps.map((g) => g.months)).toEqual([6]);
  });

  it("markerer ikke hull når datoen er en placeholder", () => {
    expect(
      detectGaps([
        role({ id: "a", startIso: "1900-01-01", endIso: "1900-01-01" }),
        role({ id: "b", startIso: "2016-07-01", endIso: "2017-01-01" }),
      ]),
    ).toEqual([]);
  });

  it("markerer ikke hull når presisjonen bare er årstall", () => {
    expect(
      detectGaps([
        role({
          id: "a",
          startIso: "2015-01-01",
          endIso: "2016-01-01",
          startPrecision: "ar",
          endPrecision: "ar",
        }),
        role({ id: "b", startIso: "2016-07-01", endIso: "2017-01-01" }),
      ]),
    ).toEqual([]);
  });

  it("markerer ikke hull når sluttdato mangler", () => {
    expect(
      detectGaps([
        role({ id: "a", startIso: "2015-01-01", endIso: null, endPrecision: null }),
        role({ id: "b", startIso: "2016-07-01", endIso: "2017-01-01" }),
      ]),
    ).toEqual([]);
  });

  it("markerer ikke hull rundt en pågående rolle", () => {
    expect(
      detectGaps([
        role({ id: "a", startIso: "2015-01-01", endIso: null, endPrecision: null, isCurrent: true }),
        role({ id: "b", startIso: "2016-07-01", endIso: "2017-01-01" }),
      ]),
    ).toEqual([]);
    expect(
      detectGaps([
        role({ id: "a", startIso: "2015-01-01", endIso: "2016-01-01" }),
        role({ id: "b", startIso: "2016-07-01", endIso: null, endPrecision: null, isCurrent: true }),
      ]),
    ).toEqual([]);
  });

  it("markerer ikke overlappende perioder", () => {
    expect(
      detectGaps([
        role({ id: "a", startIso: "2015-01-01", endIso: "2016-01-01" }),
        role({ id: "b", startIso: "2015-06-01", endIso: "2018-01-01" }),
        role({ id: "c", startIso: "2017-01-01", endIso: "2019-01-01" }),
      ]),
    ).toEqual([]);
  });

  it("hopper over roller uten startdato", () => {
    expect(
      detectGaps([
        role({ id: "a", startIso: "2015-01-01", endIso: "2016-01-01" }),
        role({ id: "b" }),
      ]),
    ).toEqual([]);
  });
});

describe("candidateSetSignature", () => {
  it("er stabil uavhengig av rekkefølge", () => {
    const a = candidateSetSignature([
      { id: "1", updated_at: "x" },
      { id: "2", updated_at: "y" },
    ]);
    const b = candidateSetSignature([
      { id: "2", updated_at: "y" },
      { id: "1", updated_at: "x" },
    ]);
    expect(a).toBe(b);
  });

  it("endres når settet endres", () => {
    const a = candidateSetSignature([{ id: "1", updated_at: "x" }]);
    expect(a).not.toBe(candidateSetSignature([{ id: "1", updated_at: "z" }]));
    expect(a).not.toBe(
      candidateSetSignature([
        { id: "1", updated_at: "x" },
        { id: "2", updated_at: "x" },
      ]),
    );
  });
});

describe("monthsBetween", () => {
  it("regner i hele måneder", () => {
    expect(monthsBetween("2020-01-01", "2020-07-01")).toBe(6);
  });
});

describe("extractRoleTitle", () => {
  it("henter tittelen fra strukturfeltet", () => {
    expect(extractRoleTitle({ title: "Kommersiell direktør (CCO)" })).toBe(
      "Kommersiell direktør (CCO)",
    );
  });

  it("avviser rollebeskrivelser som tittel", () => {
    expect(
      extractRoleTitle({
        title: "Ledet den kommersielle omstillingen fra produktsalg til abonnement, og bygde nytt team.",
      }),
    ).toBeNull();
    expect(extractRoleTitle({})).toBeNull();
  });
});
