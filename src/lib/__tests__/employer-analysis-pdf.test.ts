import { describe, expect, it } from "vitest";

import {
  fittingLineCount,
  headingFits,
  planParagraphSplit,
} from "@/lib/employers/analysis-pdf-layout";
import { buildPublicReportMeta, pdfFileName } from "@/lib/employers/analysis-pdf";
import {
  fmtScoreOrMissing,
  markdownToPlainText,
  orderedAiSignals,
  orderedDimensions,
} from "@/lib/employers/analysis-labels";
import type { EmployerAnalysisViewEnvelope } from "@/lib/queries/employer-analysis-view";

describe("PDF-layout: sideskiftregler", () => {
  it("regner ut hvor mange linjer som får plass", () => {
    expect(fittingLineCount(10, 5)).toBe(2);
    expect(fittingLineCount(9.9, 5)).toBe(1);
    expect(fittingLineCount(-1, 5)).toBe(0);
  });

  it("skriver hele avsnittet når det får plass", () => {
    expect(planParagraphSplit(4, 9)).toEqual({ placeNow: 4, remainder: 0 });
  });

  it("flytter hele avsnittet når bare én linje får plass", () => {
    expect(planParagraphSplit(5, 1)).toEqual({ placeNow: 0, remainder: 5 });
  });

  it("etterlater aldri én enkelt linje på neste side", () => {
    expect(planParagraphSplit(6, 5)).toEqual({ placeNow: 4, remainder: 2 });
  });

  it("etterlater aldri én enkelt linje nederst på siden", () => {
    expect(planParagraphSplit(3, 2)).toEqual({ placeNow: 0, remainder: 3 });
  });

  it("flytter en enkeltlinje som ikke får plass", () => {
    expect(planParagraphSplit(1, 0)).toEqual({ placeNow: 0, remainder: 1 });
  });

  it("krever at overskriften følges av minst to linjer på samme side", () => {
    expect(headingFits(20, 8, 5, 4)).toBe(true);
    expect(headingFits(15, 8, 5, 4)).toBe(false);
    // Kort blokk: én linje er nok når det er alt som finnes.
    expect(headingFits(13, 8, 5, 1)).toBe(true);
  });
});

describe("PDF-innhold", () => {
  const envelope = {
    organisasjonsnummer: "923609016",
    company: {
      id: "c1",
      name: "Equinor ASA",
      analysis_version: 2,
      analysis_rated_at: "2026-09-01T10:00:00Z",
      analysis_source_updated_at: null,
    },
    analysis: {
      overall: { score: 4.1, total_dimensions: 8, scored_dimensions: 7 },
      executive_summary: "**Sterk** aktør.",
      key_findings: ["Godt omdømme"],
      overall_assessment: "Solid arbeidsgiver.",
      dimensions: [
        {
          key: "culture",
          label: "Culture",
          score: 4,
          rationale: "r",
          what_it_means: "w",
          source_ids: [1],
          evidence_status: "sourced",
        },
      ],
      ai_maturity: null,
      supplemental_insights: null,
      sources: [{ id: 1, url: "https://example.com", category: "official" }],
    },
    register: {
      entity: { municipality: "Stavanger", industry_primary: "Energi" },
    },
    financials: null,
    weighting: {
      public: {
        employer: {
          score: 4.1,
          total_dimensions: 8,
          scored_dimensions: 7,
          weight_coverage_percent: 90,
        },
        ai: {
          score: 3,
          total_dimensions: 5,
          scored_dimensions: 5,
          weight_coverage_percent: 100,
        },
      },
      personal: {
        employer: {
          score: 4.9,
          total_dimensions: 8,
          scored_dimensions: 8,
          weight_coverage_percent: 100,
        },
        ai: {
          score: 4.8,
          total_dimensions: 5,
          scored_dimensions: 5,
          weight_coverage_percent: 100,
        },
        is_customized: true,
      },
    },
  } as unknown as EmployerAnalysisViewEnvelope;

  it("bygger offentlig metadata uten brukerdata", () => {
    const meta = buildPublicReportMeta(envelope, new Date("2026-09-15T08:00:00Z"));
    expect(meta.companyName).toBe("Equinor ASA");
    expect(meta.industry).toBe("Energi");
    expect(meta.location).toBe("Stavanger");
    expect(JSON.stringify(meta)).not.toContain("4.9");
    expect(JSON.stringify(meta)).not.toContain("is_customized");
  });

  it("lager et trygt filnavn", () => {
    const meta = buildPublicReportMeta(envelope);
    expect(pdfFileName(meta)).toBe("arbeidsgiveranalyse-equinor-asa-923609016.pdf");
  });

  it("viser «Ikke nok data» i stedet for 0", () => {
    expect(fmtScoreOrMissing(null)).toBe("Ikke nok data");
    expect(fmtScoreOrMissing(0)).toBe("0,0 / 5,0");
    expect(fmtScoreOrMissing(4)).toBe("4,0 / 5,0");
  });

  it("viser alltid åtte dimensjoner og fem AI-områder med norske navn", () => {
    const dims = orderedDimensions(envelope.analysis!.dimensions);
    expect(dims).toHaveLength(8);
    expect(dims[0].label).toBe("Kultur og verdier");
    expect(dims.map((d) => d.label)).toContain("Mangfold og inkludering");
    const signals = orderedAiSignals(undefined);
    expect(signals).toHaveLength(5);
    expect(signals[0].signal.label).toBe("Strategi og lederskap");
    expect(signals[0].signal.score).toBeNull();
  });

  it("fjerner markdown-markører fra brødtekst", () => {
    expect(markdownToPlainText("## Tittel\n**Sterk** aktør")).toBe("Tittel\nSterk aktør");
  });
});
