import { describe, expect, it } from "vitest";
import {
  deriveMarkers,
  evaluateComparisonGate,
  evaluateEmployerFilter,
  verifyDownloadIntegrity,
} from "../enheter-rules";

const rec = (o: Record<string, unknown>) =>
  ({ organisasjonsnummer: "999999999", ...o }) as never;

describe("arbeidsgiverfilter", () => {
  it("utelukker holding 64.20", () => {
    expect(evaluateEmployerFilter(rec({ naeringskode1: { kode: "64.201" } }))).toEqual({
      include: false,
      reason: "nace_excluded",
    });
  });

  it("krever ansatte for alle former utenom AS/ASA/offentlige", () => {
    expect(
      evaluateEmployerFilter(rec({ organisasjonsform: { kode: "ENK" }, antallAnsatte: 0 })).include,
    ).toBe(false);
    expect(
      evaluateEmployerFilter(rec({ organisasjonsform: { kode: "ENK" }, antallAnsatte: 2 })).include,
    ).toBe(true);
  });

  it("filtrerer ikke AS, ASA eller offentlige former på ansatte", () => {
    for (const kode of ["AS", "ASA", "STAT", "KOMM", "IKS", "ORGL"]) {
      expect(
        evaluateEmployerFilter(rec({ organisasjonsform: { kode }, antallAnsatte: 0 })).include,
      ).toBe(true);
    }
  });

  it("krever ansatte for FLI, ESEK, NUF, DA og SA", () => {
    for (const kode of ["FLI", "ESEK", "NUF", "DA", "SA"]) {
      expect(
        evaluateEmployerFilter(rec({ organisasjonsform: { kode }, antallAnsatte: 0 })),
      ).toEqual({ include: false, reason: "form_requires_employees" });
      expect(
        evaluateEmployerFilter(rec({ organisasjonsform: { kode }, antallAnsatte: 3 })).include,
      ).toBe(true);
    }
  });
});

describe("avledede markører", () => {
  it("utdanning, rekruttering og konsern", () => {
    expect(deriveMarkers(rec({ naeringskode1: { kode: "85.402" } })).er_utdanning).toBe(true);
    expect(deriveMarkers(rec({ naeringskode1: { kode: "85.100" } })).er_utdanning).toBe(false);
    expect(deriveMarkers(rec({ naeringskode1: { kode: "78.200" } })).er_rekruttering).toBe(true);
    expect(deriveMarkers(rec({ overordnetEnhet: "912345678" })).er_i_konsern).toBe(true);
    expect(deriveMarkers(rec({})).er_i_konsern).toBe(false);
  });

  it("offentlig med finansielt ORGL-unntak", () => {
    expect(
      deriveMarkers(rec({ institusjonellSektorkode: { kode: "6500" }, organisasjonsform: { kode: "KOMM" } }))
        .er_offentlig,
    ).toBe(true);
    expect(
      deriveMarkers(rec({ institusjonellSektorkode: { kode: "1120" }, organisasjonsform: { kode: "SF" } }))
        .er_offentlig,
    ).toBe(true);
    // Husbanken / Lånekassen / Eksportfinansiering Norge
    expect(
      deriveMarkers(rec({ institusjonellSektorkode: { kode: "3900" }, organisasjonsform: { kode: "ORGL" } }))
        .er_offentlig,
    ).toBe(false);
    expect(
      deriveMarkers(rec({ institusjonellSektorkode: { kode: "1120" }, organisasjonsform: { kode: "AS" } }))
        .er_offentlig,
    ).toBe(false);
  });
});

describe("sammenligningsport", () => {
  it("normal kjøring passerer", () => {
    expect(
      evaluateComparisonGate({
        filteredCount: 441_000,
        mirrorCount: 439_773,
        overlapCount: 439_500,
        markerDiffs: { er_utdanning: 0, er_rekruttering: 0, er_offentlig: 2, er_i_konsern: 5 },
      }).pass,
    ).toBe(true);
  });

  it("streng modus stopper ved ethvert avvik", () => {
    const r = evaluateComparisonGate({
      filteredCount: 439_773,
      mirrorCount: 439_773,
      overlapCount: 439_772,
      markerDiffs: { er_utdanning: 0, er_rekruttering: 0, er_offentlig: 1, er_i_konsern: 0 },
      strict: true,
      excludedPresentInMirror: 4,
    });
    expect(r.pass).toBe(false);
    expect(r.failures.length).toBeGreaterThanOrEqual(2);
  });

  it("for mange manglende stopper", () => {
    expect(
      evaluateComparisonGate({
        filteredCount: 400_000,
        mirrorCount: 439_773,
        overlapCount: 400_000,
        markerDiffs: { er_utdanning: 0, er_rekruttering: 0, er_offentlig: 0, er_i_konsern: 0 },
      }).pass,
    ).toBe(false);
  });

  it("markøravvik over terskel stopper", () => {
    expect(
      evaluateComparisonGate({
        filteredCount: 439_773,
        mirrorCount: 439_773,
        overlapCount: 439_773,
        markerDiffs: { er_utdanning: 3000, er_rekruttering: 0, er_offentlig: 0, er_i_konsern: 0 },
      }).pass,
    ).toBe(false);
  });
});

describe("filintegritet", () => {
  it("stopper fase 2 ved feil størrelse", () => {
    expect(verifyDownloadIntegrity({ expectedBytes: 209_000_000, actualBytes: 209_000_000 }).ok).toBe(true);
    expect(verifyDownloadIntegrity({ expectedBytes: 209_000_000, actualBytes: 104_000_000 }).reason).toBe(
      "size_mismatch",
    );
    expect(verifyDownloadIntegrity({ expectedBytes: null, actualBytes: 1 }).reason).toBe(
      "missing_content_length",
    );
  });
});

describe("er_i_konsern er unntatt stoppkriteriet", () => {
  const base = {
    filteredCount: 443_248,
    mirrorCount: 439_773,
    overlapCount: 435_952,
  };

  it("stort konsernavvik stopper ikke porten, men rapporteres", () => {
    const r = evaluateComparisonGate({
      ...base,
      markerDiffs: { er_utdanning: 0, er_rekruttering: 44, er_offentlig: 0, er_i_konsern: 30_074 },
    });
    expect(r.pass).toBe(true);
    expect(r.warnings.some((w) => w.startsWith("er_i_konsern="))).toBe(true);
  });

  it("streng modus stopper heller ikke på konsern alene", () => {
    const r = evaluateComparisonGate({
      ...base,
      overlapCount: 439_773,
      markerDiffs: { er_utdanning: 0, er_rekruttering: 0, er_offentlig: 0, er_i_konsern: 30_074 },
      strict: true,
    });
    expect(r.failures.some((f) => f.includes("markøravvik"))).toBe(false);
  });
});
