import {
  estimateModelCostUsd,
  extractXaiResponseText,
  financialsFromResearchPack,
  hasRegisterFinancials,
  normalizeEmployerResearchPack,
} from "./research-v1.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("register financials suppress external financial fallback", () => {
  const result = normalizeEmployerResearchPack({
    financial_supplement: { status: "found", revenue: 10 },
  }, {
    companyName: "Test AS",
    organisationNumber: "123456789",
    registerHasFinancials: true,
  });
  assert(result.financial_supplement.status === "not_needed", "register must win");
  assert(result.financial_supplement.revenue === null, "supplement values must be discarded");
});

Deno.test("normalizes evidence and official financial fallback", () => {
  const result = normalizeEmployerResearchPack({
    company_scope: { legal_entity_name: "Test AS" },
    evidence: [
      {
        id: 7,
        url: "https://example.com/report.pdf",
        category: "annual_report",
        fact_keys: ["financial"],
        excerpt: "Kontakt jane@example.com eller +47 999 88 777",
      },
      { id: 8, url: "https://example.com/report.pdf?tracking=1", category: "annual_report" },
    ],
    financial_supplement: {
      status: "found",
      source_type: "annual_report",
      reporting_period: "2025",
      currency: "NOK",
      revenue: 100,
      source_ids: [7],
    },
  }, {
    companyName: "Fallback",
    organisationNumber: null,
    registerHasFinancials: false,
  });
  assert(result.evidence.length === 1, "URLs are deduplicated");
  assert(!result.evidence[0].excerpt.includes("jane@example.com"), "email is redacted");
  assert(!result.evidence[0].excerpt.includes("999 88 777"), "phone is redacted");
  assert(result.financial_supplement.status === "found", "fallback retained");
  assert(result.financial_supplement.source_type === "annual_report", "official source retained");
  assert(
    financialsFromResearchPack(result)?.source_kind === "official_web_fallback",
    "fallback financials are explicitly labeled",
  );
});

Deno.test("calculates versioned model estimate", () => {
  const cost = estimateModelCostUsd("claude-haiku-4-5", {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    webSearchRequests: 2,
  }, { anthropicWebSearch: true });
  assert(cost === 6.02, "Haiku token and search price snapshot");
});

Deno.test("extracts text from xAI Responses API payload", () => {
  const text = extractXaiResponseText({
    output: [{ content: [{ type: "output_text", text: "{\"ok\":true}" }] }],
  });
  assert(text === '{"ok":true}', "response text extracted");
});

Deno.test("detects local financial history", () => {
  assert(hasRegisterFinancials({ financial_history: [{ year: 2025 }] }), "history detected");
  assert(!hasRegisterFinancials({ financial_history: [] }), "empty history rejected");
});
