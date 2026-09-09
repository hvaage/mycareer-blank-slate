import { describe, expect, it } from "vitest";
import {
  accountClaims,
  extractNorwegianPeriods,
} from "../../../supabase/functions/_shared/cv-skills/generation/claim-accounting";
import type { SnapshotAtom } from "../../../supabase/functions/_shared/cv-skills/generation/contract";

const roleAtom = (overrides: Partial<SnapshotAtom> = {}): SnapshotAtom =>
  ({
    id: "atom-role",
    atom_type: "rolle",
    parent_atom_id: null,
    content_no: "Country Manager hos Symantec Norway",
    content_en: "Country Manager at Symantec Norway",
    source_quote: null,
    confidence: "high",
    structured_data: { start_date: "1998-04", end_date: "2006-06" },
    ...overrides,
  }) as SnapshotAtom;

const claim = (value: string, atomIds: string[], type: "hard" | "soft" = "hard") => ({
  claimId: "c1",
  blockId: "b1",
  type,
  value,
  supportingAtomIds: atomIds,
  verification: "unsupported" as const,
});

describe("norske perioder", () => {
  it("leser måned og år", () => {
    expect(extractNorwegianPeriods("Periode april 2007 til desember 2014")).toEqual([
      "2007-04",
      "2014-12",
    ]);
  });

  it("belegges av datoer i egne supporting atoms", () => {
    const acc = accountClaims([claim("Periode april 1998 til juni 2006", ["atom-role"])], [roleAtom()]);
    expect(acc.entries[0].verification).toBe("supported");
    expect(acc.entries[0].reason).toContain("period_match");
  });

  it("avvist når datoene ikke stemmer", () => {
    const acc = accountClaims([claim("Periode april 1999 til juni 2006", ["atom-role"])], [roleAtom()]);
    expect(acc.entries[0].verification).toBe("unsupported");
  });

  it("dato i et annet atom belegger ikke claimen", () => {
    const other = roleAtom({ id: "atom-other" });
    const scoped = roleAtom({ id: "atom-role", structured_data: {} as never, content_no: "Rolle", content_en: null });
    const acc = accountClaims([claim("Periode april 1998 til juni 2006", ["atom-role"])], [scoped, other]);
    expect(acc.entries[0].verification).not.toBe("supported");
  });
});

describe("regnskap", () => {
  it("strukturelle elementer telles ikke som faktapåstander", () => {
    const acc = accountClaims([claim("Erfaring", ["atom-role"])], [roleAtom()]);
    expect(acc.entries[0].verification).toBe("not_applicable");
  });

  it("claim uten supporting atoms er unsupported", () => {
    const acc = accountClaims([claim("Country Manager", [])], [roleAtom()]);
    expect(acc.entries[0].verification).toBe("unsupported");
    expect(acc.summary.total).toBe(1);
  });
});
