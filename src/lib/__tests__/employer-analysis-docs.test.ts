import { describe, expect, it } from "vitest";
import { normalizeEmployerName } from "@/lib/queries/employer-analysis-docs";

describe("normalizeEmployerName", () => {
  it("trenger gjennom case og selskapsform", () => {
    expect(normalizeEmployerName("SOPRA STERIA AS")).toBe("sopra steria");
    expect(normalizeEmployerName("Sopra Steria")).toBe("sopra steria");
  });
  it("fjerner vanlige norske selskapsformer", () => {
    expect(normalizeEmployerName("Equinor ASA")).toBe("equinor");
    expect(normalizeEmployerName("Atea AS")).toBe("atea");
    expect(normalizeEmployerName("TET DIGITAL AS AVD OSLO")).toBe("tet digital as avd oslo");
  });
  it("håndterer tomme verdier og punktsetting", () => {
    expect(normalizeEmployerName(null)).toBe("");
    expect(normalizeEmployerName("  ")).toBe("");
    expect(normalizeEmployerName("Sky Rekruttering, As")).toBe("sky rekruttering");
  });
});
