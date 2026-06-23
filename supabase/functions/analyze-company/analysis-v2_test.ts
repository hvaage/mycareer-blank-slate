import {
  enforceEvidenceReferences,
  financialsFromRegisterContext,
  isEvaluationPlatformSource,
  neutralizeEvaluationPlatformNames,
  normalizeCandidateScenarioNotes,
  normalizeEmployerAnalysisV2,
  normalizeScore,
  userFacingAnalysisSources,
} from "./analysis-v2.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("normalizes scores to the 1-5 half-point scale", () => {
  assert(normalizeScore(4.26) === 4.5, "round to half point");
  assert(normalizeScore(9) === 5, "clamp upper bound");
  assert(normalizeScore(0) === 1, "clamp lower bound");
  assert(normalizeScore("4") === null, "reject string scores");
});

Deno.test("normalizes private candidate scenario notes", () => {
  const notes = normalizeCandidateScenarioNotes(["  First ", null, "", "Second", "Third", "Fourth", "Fifth", "Sixth"]);
  assert(notes.length === 5, "scenario notes capped at five");
  assert(notes[0] === "First", "scenario notes trimmed");
});

Deno.test("neutralizes named evaluation platforms in user-facing text", () => {
  const output = neutralizeEvaluationPlatformNames(
    "Glassdoor og Jobbi.no viser signaler, mens Levels.fyi og Reviewportal.no omtaler lonn.",
    ["reviewportal"],
  );
  assert(!/glassdoor|jobbi|levels|reviewportal/i.test(output), "brand names must be removed");
  assert(/ansattvurderingskilde/i.test(output), "neutral category remains");
});

Deno.test("removes evaluation platforms from user-facing source lists", () => {
  const sources = userFacingAnalysisSources([
    { id: 1, url: "https://glassdoor.com/company", category: "other" },
    { id: 2, url: "https://example.com/reviews", category: "employee_reviews" },
    { id: 3, url: "https://example.com/annual-report", category: "annual_report" },
  ]);
  assert(sources.length === 1 && sources[0].id === 3, "only safe public source remains");
  assert(
    isEvaluationPlatformSource({ url: "not-a-url", category: "other" }),
    "invalid source URLs are hidden",
  );
});

Deno.test("normalizes the fixed 8 plus 5 analysis contract", () => {
  const result = normalizeEmployerAnalysisV2({
    overall: {},
    executive_summary: "Glassdoor viser et positivt bilde.",
    key_findings: ["Jobbi.no har flere omtaler."],
    dimensions: [
      { key: "culture", score: 4.2, evidence_status: "sourced", rationale: "Bra", source_ids: [1] },
      { key: "leadership", score: 2, evidence_status: "insufficient_evidence" },
    ],
    ai_maturity: {
      applicable: true,
      signals: {
        strategy_and_leadership: { score: 4.4, rationale: "Tydelig strategi" },
      },
    },
    supplemental_insights: {
      esg_and_regulatory: {
        evidence_status: "sourced",
        narrative: "Great Place to Work og en regulator omtaler arbeidet.",
        highlights: ["Dokumentert rapportering"],
        source_ids: [1],
      },
      employee_sentiment_trend: {
        evidence_status: "sourced",
        direction: "stable",
        narrative: "Glassdoor viser stabil score.",
        source_ids: [1, 2],
      },
      compensation_signals: {
        evidence_status: "inferred",
        narrative: "Levels.fyi indikerer et intervall.",
        source_ids: [3],
      },
    },
    overall_assessment: "Jobbi.no underbygger helhetsbildet.",
  });
  assert(result.dimensions.length === 8, "all employer dimensions are present");
  assert(result.dimensions[0].score === 4, "dimension score is normalized");
  assert(result.dimensions[1].score === null, "insufficient evidence has no score");
  assert(Object.keys(result.ai_maturity.signals).length === 5, "all AI signals are present");
  assert(result.ai_maturity.signals.strategy_and_leadership.score === 4.5, "AI score normalized");
  assert(result.supplemental_insights.employee_sentiment_trend.direction === "stable", "trend normalized");
  assert(!/glassdoor|jobbi|levels|great place to work/i.test(JSON.stringify(result)), "user-facing brands neutralized");
});

Deno.test("builds deterministic financials from the register snapshot", () => {
  const financials = financialsFromRegisterContext({
    organisasjonsnummer: "123456789",
    source_updated_at: "2026-06-22T10:00:00Z",
    financial_history: [{
      year: 2025,
      currency: "NOK",
      revenue: 100,
      operating_result: 12,
      annual_result: 9,
      equity_ratio_percent: 42,
    }],
  });
  assert(financials?.source_kind === "brreg_local_mirror", "local mirror provenance");
  assert(financials?.revenue_latest === 100, "latest revenue copied");
  assert(financials?.fiscal_year === 2025, "latest year copied");
});

Deno.test("rejects invented and insufficient evidence references", () => {
  const normalized = normalizeEmployerAnalysisV2({
    dimensions: [
      { key: "culture", score: 4, evidence_status: "sourced", source_ids: [1, 2, 999] },
      { key: "leadership", score: 5, evidence_status: "sourced", source_ids: [1] },
    ],
    ai_maturity: {
      applicable: true,
      signals: {
        strategy_and_leadership: { score: 4, source_ids: [2] },
        workforce: { score: 5, source_ids: [999] },
      },
    },
    supplemental_insights: {
      esg_and_regulatory: { evidence_status: "sourced", source_ids: [1] },
      employee_sentiment_trend: { evidence_status: "sourced", direction: "stable", source_ids: [1] },
      compensation_signals: { evidence_status: "sourced", source_ids: [999] },
    },
  });
  const result = enforceEvidenceReferences(normalized, [1, 2]);
  assert(result.dimensions[0].score === 4, "two valid sources preserve employer score");
  assert(result.dimensions[0].source_ids.length === 2, "invented source removed");
  assert(result.dimensions[1].score === null, "one source is insufficient for employer dimension");
  assert(result.ai_maturity.signals.strategy_and_leadership.score === 4, "one valid source preserves AI signal");
  assert(result.ai_maturity.signals.workforce.score === null, "invented-only AI source rejects score");
  assert(result.supplemental_insights.esg_and_regulatory.evidence_status === "sourced", "one source preserves ESG insight");
  assert(
    result.supplemental_insights.employee_sentiment_trend.evidence_status === "insufficient_evidence",
    "sentiment trend requires two sources",
  );
  assert(
    result.supplemental_insights.compensation_signals.evidence_status === "insufficient_evidence",
    "invented compensation source is rejected",
  );
});
