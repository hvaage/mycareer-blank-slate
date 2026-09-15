import { buildEmployerAnalysisPdf } from "@/lib/employers/analysis-pdf";
import type { EmployerAnalysisViewEnvelope } from "@/lib/queries/employer-analysis-view";

const lorem =
  "Selskapet har en tydelig uttalt verdiplattform som gjenspeiles i offentlig tilgjengelige styringsdokumenter, og flere uavhengige kilder beskriver en kultur preget av høy faglighet, sterkt sikkerhetsfokus og relativt flate strukturer. Samtidig peker enkelte kilder på at endringstakten de siste årene har skapt press i deler av organisasjonen.";

const dimKeys = [
  "culture",
  "leadership",
  "work_environment",
  "career_development",
  "financial_stability",
  "mission",
  "talent_attraction_retention",
  "diversity_inclusion",
];

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
    executive_summary: "**Equinor** er en av Norges mest attraktive arbeidsgivere. " + lorem,
    key_findings: [
      "Sterk finansiell stabilitet med solid egenkapitalandel over flere år.",
      "Godt dokumentert satsing på kompetanseutvikling og interne karriereveier.",
      "Blandede signaler om arbeidsbelastning i enkelte forretningsområder.",
      "Tydelig klimastrategi, men ekstern kritikk av tempoet i omstillingen.",
      "Mangfoldsarbeid er formalisert, med måltall som rapporteres offentlig.",
    ],
    overall_assessment: lorem + " " + lorem,
    dimensions: dimKeys.map((key, i) => ({
      key,
      label: key,
      score: i === 7 ? null : 3 + (i % 3) * 0.5,
      rationale: i === 7 ? null : lorem,
      what_it_means: i === 7 ? null : "For en jobbsøker betyr dette at du kan forvente strukturert onboarding og tydelige forventninger, men bør avklare arbeidsbelastning i intervju.",
      source_ids: [1, 2],
      evidence_status: i === 7 ? "insufficient" : i % 2 ? "inferred" : "sourced",
    })),
    ai_maturity: {
      score: 3.4,
      narrative: lorem,
      applicable: true,
      applicability_note: null,
      source_ids: [1],
      key_evidence: ["Egen AI-enhet etablert i 2024.", "Offentlig publisert retningslinje for ansvarlig AI."],
      signals: {
        strategy_and_leadership: { label: "x", score: 4, rationale: lorem, source_ids: [1] },
        capability_and_deployment: { label: "x", score: 3.5, rationale: lorem, source_ids: [] },
        workforce: { label: "x", score: null, rationale: null, source_ids: [] },
        governance: { label: "x", score: 3, rationale: lorem, source_ids: [] },
        market_and_product: { label: "x", score: 2.5, rationale: lorem, source_ids: [] },
      },
    },
    supplemental_insights: {
      esg_and_regulatory: {
        narrative: lorem,
        highlights: ["Rapporterer etter CSRD.", "Ingen vesentlige tilsynssaker siste tre år."],
        source_ids: [1],
        evidence_status: "sourced",
      },
      employee_sentiment_trend: {
        narrative: lorem,
        highlights: ["Stabil utvikling siste to år."],
        source_ids: [],
        evidence_status: "inferred",
        direction: "stable",
      },
      compensation_signals: {
        narrative: "Selskapet oppgir selv at lønn fastsettes etter sentrale tariffavtaler og interne stiger.",
        highlights: [],
        source_ids: [],
        evidence_status: "insufficient",
      },
    },
    sources: Array.from({ length: 14 }, (_, i) => ({
      id: i + 1,
      url: `https://www.example.no/rapporter/aarsrapport-2025-del-${i + 1}`,
      category: i % 2 ? "Offisiell rapport" : "Redaksjonell kilde",
    })),
  },
  register: {
    entity: {
      municipality: "Stavanger",
      county: "Rogaland",
      industry_primary: "Utvinning av råolje og naturgass",
      employee_count: 22500,
    },
  },
  financials: {
    currency: "NOK",
    fiscal_year: 2025,
    revenue_latest: 1024000000000,
    operating_result_latest: 210000000000,
    profit_latest: 98000000000,
    equity_latest: 430000000000,
    debt_latest: 320000000000,
    assets_latest: 750000000000,
    equity_ratio_percent: 57.3,
    operating_margin_percent: 20.5,
    source_kind: "brreg_local_mirror",
    source_updated_at: null,
  },
  weighting: {
    public: {
      employer: { score: 4.12, total_dimensions: 8, scored_dimensions: 7, weight_coverage_percent: 88.5 },
      ai: { score: 3.25, total_dimensions: 5, scored_dimensions: 4, weight_coverage_percent: 80 },
    },
    personal: null,
  },
} as unknown as EmployerAnalysisViewEnvelope;

const { doc } = await buildEmployerAnalysisPdf(envelope, new Date("2026-09-15T08:00:00Z"));
const bytes = doc.output("arraybuffer");
await Bun.write("/tmp/qa/analyse.pdf", bytes);
console.log("pages", doc.getNumberOfPages());
