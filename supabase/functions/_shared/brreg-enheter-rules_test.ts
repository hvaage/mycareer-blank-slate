import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deriveMarkers,
  evaluateComparisonGate,
  evaluateEmployerFilter,
  verifyDownloadIntegrity,
} from "./brreg-enheter-rules.ts";

const rec = (o: Record<string, unknown>) => ({
  organisasjonsnummer: "999999999",
  ...o,
} as never);

Deno.test("filter: holding 64.20 utelukkes", () => {
  const d = evaluateEmployerFilter(rec({ naeringskode1: { kode: "64.201" } }));
  assertEquals(d, { include: false, reason: "nace_excluded" });
});

Deno.test("filter: ENK uten ansatte utelukkes, med ansatte inkluderes", () => {
  assertEquals(
    evaluateEmployerFilter(rec({ organisasjonsform: { kode: "ENK" }, antallAnsatte: 0 })).include,
    false,
  );
  assertEquals(
    evaluateEmployerFilter(rec({ organisasjonsform: { kode: "ENK" }, antallAnsatte: 2 })).include,
    true,
  );
});

Deno.test("filter: AS uten ansatte inkluderes", () => {
  assertEquals(
    evaluateEmployerFilter(rec({ organisasjonsform: { kode: "AS" }, antallAnsatte: 0 })).include,
    true,
  );
});

Deno.test("markører: utdanning, rekruttering, konsern", () => {
  assertEquals(deriveMarkers(rec({ naeringskode1: { kode: "85.402" } })).er_utdanning, true);
  assertEquals(deriveMarkers(rec({ naeringskode1: { kode: "85.100" } })).er_utdanning, false);
  assertEquals(deriveMarkers(rec({ naeringskode1: { kode: "78.200" } })).er_rekruttering, true);
  assertEquals(deriveMarkers(rec({ overordnetEnhet: "912345678" })).er_i_konsern, true);
  assertEquals(deriveMarkers(rec({})).er_i_konsern, false);
});

Deno.test("markører: offentlig med finansielt ORGL-unntak", () => {
  assertEquals(
    deriveMarkers(rec({ institusjonellSektorkode: { kode: "6500" }, organisasjonsform: { kode: "KOMM" } })).er_offentlig,
    true,
  );
  assertEquals(
    deriveMarkers(rec({ institusjonellSektorkode: { kode: "1120" }, organisasjonsform: { kode: "SF" } })).er_offentlig,
    true,
  );
  // Husbanken-tilfellet
  assertEquals(
    deriveMarkers(rec({ institusjonellSektorkode: { kode: "3900" }, organisasjonsform: { kode: "ORGL" } })).er_offentlig,
    false,
  );
  assertEquals(
    deriveMarkers(rec({ institusjonellSektorkode: { kode: "1120" }, organisasjonsform: { kode: "AS" } })).er_offentlig,
    false,
  );
});

Deno.test("sammenligningsport: normal kjøring passerer", () => {
  const r = evaluateComparisonGate({
    filteredCount: 441_000,
    mirrorCount: 439_773,
    overlapCount: 439_500,
    markerDiffs: { er_utdanning: 0, er_rekruttering: 0, er_offentlig: 2, er_i_konsern: 5 },
  });
  assertEquals(r.pass, true);
});

Deno.test("sammenligningsport: for mange manglende stopper", () => {
  const r = evaluateComparisonGate({
    filteredCount: 400_000,
    mirrorCount: 439_773,
    overlapCount: 400_000,
    markerDiffs: { er_utdanning: 0, er_rekruttering: 0, er_offentlig: 0, er_i_konsern: 0 },
  });
  assertEquals(r.pass, false);
});

Deno.test("sammenligningsport: markøravvik over terskel stopper", () => {
  const r = evaluateComparisonGate({
    filteredCount: 439_773,
    mirrorCount: 439_773,
    overlapCount: 439_773,
    markerDiffs: { er_utdanning: 3000, er_rekruttering: 0, er_offentlig: 0, er_i_konsern: 0 },
  });
  assertEquals(r.pass, false);
});

Deno.test("filintegritet: mismatch stopper fase 2", () => {
  assertEquals(verifyDownloadIntegrity({ expectedBytes: 209_000_000, actualBytes: 209_000_000 }).ok, true);
  assertEquals(verifyDownloadIntegrity({ expectedBytes: 209_000_000, actualBytes: 104_000_000 }).reason, "size_mismatch");
  assertEquals(verifyDownloadIntegrity({ expectedBytes: null, actualBytes: 1 }).reason, "missing_content_length");
});
