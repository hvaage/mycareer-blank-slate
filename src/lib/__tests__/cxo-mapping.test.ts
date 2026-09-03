import { describe, expect, it } from "vitest";
import { lookupCxO, getAllCxOMappings } from "@/lib/cxo-mapping";

describe("CxO-mapping", () => {
  it("slår opp CCO som Chief Commercial Officer", () => {
    const hit = lookupCxO("CCO");
    expect(hit).not.toBeNull();
    expect(hit!.abbreviation).toBe("CCO");
    expect(hit!.expanded).toBe("Chief Commercial Officer");
    expect(hit!.norwegianTitle).toBe("salgsdirektør");
    expect(hit!.escoUri).toContain("esco/occupation/");
  });

  it("tolererer punktum og mellomrom i forkortelsen", () => {
    expect(lookupCxO("C.C.O.")).not.toBeNull();
    expect(lookupCxO("  cmo ")).not.toBeNull();
  });

  it("returnerer null for ukjente forkortelser", () => {
    expect(lookupCxO("XYZ")).toBeNull();
    expect(lookupCxO("Utvikler")).toBeNull();
  });

  it("inneholder alle forventede CxO-er", () => {
    const abbrs = new Set(getAllCxOMappings().map((m) => m.abbreviation));
    for (const expected of ["CEO", "CFO", "COO", "CTO", "CIO", "CISO", "CMO", "CRO", "CCO", "CHRO", "CPO", "CDO", "CLO"]) {
      expect(abbrs.has(expected)).toBe(true);
    }
  });
});
