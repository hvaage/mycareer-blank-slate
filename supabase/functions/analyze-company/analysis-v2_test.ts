import {
  financialsFromRegisterContext,
  neutralizeEvaluationPlatformNames,
  normalizeEmployerAnalysisV2,
  normalizeScore,
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

Deno.test("neutralizes named evaluation platforms in user-facing text", () => {
  const output = neutralizeEvaluationPlatformNames(
    "Glassdoor og Jobbi.no viser signaler, mens Levels.fyi og Reviewportal.no omtaler lonn.",
    ["reviewportal"],
  );
  assert(!/glassdoor|jobbi|levels|reviewportal/i.test(output), "brand names must be removed");
  assert(/ansattvurderingskilde/i.test(output), "neutral category remains");
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
  });
  assert(result.dimensions.length === 8, "all employer dimensions are present");
  assert(result.dimensions[0].score === 4, "dimension score is normalized");
  assert(result.dimensions[1].score === null, "insufficient evidence has no score");
  assert(Object.keys(result.ai_maturity.signals).length === 5, "all AI signals are present");
  assert(result.ai_maturity.signals.strategy_and_leadership.score === 4.5, "AI score normalized");
  assert(!/glassdoor|jobbi/i.test(JSON.stringify(result)), "user-facing brands neutralized");
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
